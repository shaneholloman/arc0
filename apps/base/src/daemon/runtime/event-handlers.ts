import { randomUUID } from "node:crypto";
import { eventBus } from "../../lib/events.js";
import { findPaneByTty, sendToPane } from "../../lib/tmux.js";
import type { SessionFileWatcher } from "../session-files/watcher.js";
import type { SocketServer } from "../../socket/socket-server.js";
import { jsonlWatcher, jsonlStore } from "../../transcript/index.js";
import { isCustomTitleLine } from "../../providers/claude/transformer/guards.js";
import { pendingSessionNames } from "../../socket/session-launcher.js";
import { sessionFileToData } from "./session-data.js";
import { linesToTimelineItems } from "./timeline.js";

interface RegisterDaemonEventHandlersOptions {
  sessionWatcher: SessionFileWatcher;
  socketServer: SocketServer;
  workstationId: string;
}

export function registerDaemonEventHandlers(
  options: RegisterDaemonEventHandlersOptions,
): void {
  const { sessionWatcher, socketServer, workstationId } = options;

  // Pending renames keyed by sessionId, resolved from TTY at session:start,
  // consumed on the first messages:new (when CLI is ready for input).
  const pendingRenames = new Map<
    string,
    { name: string; tty: string }
  >();

  // Subscribe to eventBus - handle session and message events
  eventBus.on("session:start", (session) => {
    console.log(`[${session.provider}] session:start: ${session.sessionId}`);

    // Start watching the JSONL file for this session
    if (session.transcriptPath) {
      jsonlWatcher.watchSession(session.sessionId, session.transcriptPath);
    }

    // Re-key pending name from tty→name to sessionId→{name,tty}.
    // The actual /rename is deferred to messages:new when CLI is ready.
    if (session.tty) {
      const pendingName = pendingSessionNames.get(session.tty);
      if (pendingName) {
        pendingSessionNames.delete(session.tty);
        pendingRenames.set(session.sessionId, {
          name: pendingName,
          tty: session.tty,
        });
        console.log(
          `[daemon] Queued rename for session ${session.sessionId}: '${pendingName}'`,
        );
      }
    }
  });

  eventBus.on("session:end", (sessionId) => {
    console.log(`[daemon] session:end: ${sessionId}`);

    // Stop watching the JSONL file
    jsonlWatcher.unwatchSession(sessionId);
    pendingRenames.delete(sessionId);
  });

  eventBus.on("sessions:change", async (sessions) => {
    console.log(`[daemon] sessions:change: ${sessions.length} active`);
    const sessionData = await Promise.all(sessions.map(sessionFileToData));
    socketServer.sendSessionsSync({
      workstationId,
      sessions: sessionData,
    });
  });

  // Handle new messages from JSONL watcher
  eventBus.on("messages:new", (sessionId, lines) => {
    console.log(
      `[daemon] messages:new: ${lines.length} lines for ${sessionId}`,
    );

    // Auto-rename: first messages:new means CLI is initialized and ready.
    // Send /rename now (deferred from session:start).
    const pendingRename = pendingRenames.get(sessionId);
    if (pendingRename) {
      pendingRenames.delete(sessionId);
      console.log(
        `[daemon] Auto-renaming session ${sessionId} to '${pendingRename.name}'`,
      );
      findPaneByTty(pendingRename.tty).then((pane) => {
        if (pane) {
          sendToPane(pane, `/rename ${pendingRename.name}`);
        }
      });
    }

    // Detect custom-title lines (session rename via /rename)
    const nameChangeItems: import("@arc0/types").TimelineItem[] = [];
    for (const line of lines) {
      if (isCustomTitleLine(line.raw)) {
        const newName = line.raw.customTitle;
        console.log(
          `[daemon] Session name change: ${sessionId} -> '${newName}'`,
        );
        jsonlStore.setName(sessionId, newName);

        nameChangeItems.push({
          kind: "session_event",
          sessionId,
          event: {
            type: "session_name_change",
            name: newName,
            timestamp: new Date().toISOString(),
          },
        });
      }
    }

    const session = sessionWatcher
      .getActiveSessions()
      .find((s) => s.sessionId === sessionId);
    if (!session) return;

    const messageItems = linesToTimelineItems(session, lines);

    // Merge name change events into the same batch as transcript items
    // so the client cursor advances atomically.
    const items = [...nameChangeItems, ...messageItems];
    if (items.length === 0) return;

    // Broadcast to all connected clients
    socketServer.sendMessagesBatch({
      workstationId,
      items,
      batchId: randomUUID(),
    });
  });

  // Handle permission request events - send through messages channel
  eventBus.on("permission:request", (sessionId, event) => {
    if (event.type !== "permission_request") return;
    console.log(
      `[daemon] permission:request: ${event.toolName} for ${sessionId}`,
    );

    socketServer.sendMessagesBatch({
      workstationId,
      items: [{ kind: "session_event", sessionId, event }],
      batchId: randomUUID(),
    });
  });
}
