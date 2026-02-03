import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { RawMessageEnvelope } from "@arc0/types";
import { ControlServer, SocketServer } from "./server.js";
import { createActionHandlers } from "./actions.js";
import {
  ClaudeWatcher,
  CodexWatcher,
  GeminiWatcher,
  SessionFileWatcher,
} from "./watchers/index.js";
import { jsonlWatcher } from "./jsonl/index.js";
import { projectStore } from "./projects/index.js";
import { createFrpcManager, type FrpcManager } from "./frpc-manager.js";
import {
  writeDaemonState,
  removeDaemonState,
  readDaemonState,
  acquireDaemonLock,
  VERSION,
  eventBus,
  ensureCredentials,
  findPaneByTty,
  loadConfig,
  getPreferredPorts,
  savePreferredPorts,
  SESSIONS_DIR,
  type Arc0Config,
  type SessionFile,
  type SessionData,
  type StoredLine,
} from "../shared/index.js";
import { loadClientStore } from "../shared/clients.js";

async function sessionFileToData(session: SessionFile): Promise<SessionData> {
  // Check if session is running in tmux (interactive)
  let interactive = false;
  if (session.tty) {
    const pane = await findPaneByTty(session.tty);
    interactive = pane !== null;
  }

  return {
    id: session.sessionId,
    provider: session.provider,
    cwd: session.cwd,
    name: null, // TODO: extract from JSONL
    model: null, // TODO: extract from JSONL
    gitBranch: null, // TODO: extract from JSONL or git
    startedAt: session.startedAt,
    interactive,
  };
}

/**
 * Convert StoredLines to RawMessageEnvelopes for sending.
 */
function linesToEnvelopes(
  sessionId: string,
  lines: StoredLine[],
): RawMessageEnvelope[] {
  return lines.map((line) => ({
    sessionId,
    payload: line.raw,
  }));
}

function getPayloadTimestamp(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const maybeTimestamp = (payload as { timestamp?: unknown }).timestamp;
  return typeof maybeTimestamp === "string" ? maybeTimestamp : "";
}

/**
 * Read the most recent permission_request event for a session (if any).
 * Used for reconnect/initial sync so clients don't miss pending approvals.
 */
function readLatestPermissionRequestEnvelope(
  sessionId: string,
): RawMessageEnvelope[] {
  const eventsPath = join(SESSIONS_DIR, `${sessionId}.events.jsonl`);
  if (!existsSync(eventsPath)) return [];

  try {
    const content = readFileSync(eventsPath, "utf-8");
    const lines = content.split("\n").filter((line) => line.trim());
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const line = lines[i];
        if (!line) continue;
        const event = JSON.parse(line) as unknown;
        if (
          event &&
          typeof event === "object" &&
          (event as { type?: unknown }).type === "permission_request" &&
          typeof (event as { toolUseId?: unknown }).toolUseId === "string" &&
          typeof (event as { timestamp?: unknown }).timestamp === "string"
        ) {
          return [{ sessionId, payload: event }];
        }
      } catch {
        // Invalid JSON line, skip
      }
    }
  } catch {
    // File unreadable, ignore
  }

  return [];
}

/**
 * Merge two already timestamp-ordered envelope lists into one.
 * Tie-breaker: transcript envelopes first when timestamps are equal.
 */
function mergeEnvelopesByTimestamp(
  transcript: RawMessageEnvelope[],
  events: RawMessageEnvelope[],
): RawMessageEnvelope[] {
  const merged: RawMessageEnvelope[] = [];
  let i = 0;
  let j = 0;

  while (i < transcript.length && j < events.length) {
    const a = transcript[i]!;
    const b = events[j]!;

    const aTs = getPayloadTimestamp(a.payload);
    const bTs = getPayloadTimestamp(b.payload);

    if (aTs.localeCompare(bTs) <= 0) {
      merged.push(a);
      i++;
    } else {
      merged.push(b);
      j++;
    }
  }

  while (i < transcript.length) {
    merged.push(transcript[i]!);
    i++;
  }
  while (j < events.length) {
    merged.push(events[j]!);
    j++;
  }

  return merged;
}

async function main() {
  // Load config
  const config = loadConfig();
  if (!config?.workstationId) {
    console.error(
      "[daemon] Config not found or missing workstationId. Run 'arc0 init' first.",
    );
    process.exit(1);
  }

  const { workstationId } = config;
  console.log(`[daemon] Workstation: ${workstationId}`);

  // Ensure credentials exist (generates secret on first run)
  const credentials = ensureCredentials();
  console.log(`[daemon] Secret loaded (share with mobile app to connect)`);

  // Acquire exclusive lock (handles crash recovery automatically)
  const releaseLock = await acquireDaemonLock();

  if (!releaseLock) {
    const state = readDaemonState();
    console.error(
      `[daemon] Another daemon is already running (PID: ${state?.pid}, control: ${state?.controlPort}, socket: ${state?.socketPort})`,
    );
    console.error(
      "[daemon] Use 'arc0 stop' to stop it first, or 'arc0 status' to check its status.",
    );
    process.exit(1);
  }

  console.log("[daemon] Starting Arc0 daemon...");

  // Initialize watchers first (so we can get sessions on connect)
  const sessionWatcher = new SessionFileWatcher();
  const claudeWatcher = new ClaudeWatcher();
  const codexWatcher = new CodexWatcher();
  const geminiWatcher = new GeminiWatcher();

  // Create action handlers with access to session data
  const actionHandlers = createActionHandlers({
    getSession: (sessionId) => {
      return sessionWatcher
        .getActiveSessions()
        .find((s) => s.sessionId === sessionId);
    },
  });

  // Get preferred ports from config (if any)
  const portPrefs = getPreferredPorts();
  if (portPrefs) {
    console.log(
      `[daemon] Found port preferences (control: ${portPrefs.controlPort ?? "none"}, socket: ${portPrefs.socketPort ?? "none"})`,
    );
  }

  // Track ports as they become ready
  let controlPort = 0;
  let socketPort = 0;

  // Helper to write state once both ports are ready
  const maybeWriteState = () => {
    if (controlPort > 0 && socketPort > 0) {
      writeDaemonState({
        version: VERSION,
        pid: process.pid,
        controlPort,
        socketPort,
        startedAt: new Date().toISOString(),
      });
      // Save port preferences for next startup
      savePreferredPorts(controlPort, socketPort);
      console.log(
        `[daemon] State written (control: ${controlPort}, socket: ${socketPort})`,
      );
    }
  };

  // Create control server (localhost only, for CLI)
  const controlServer = new ControlServer({
    preferredPort: portPrefs?.controlPort,
    onReady: (port) => {
      controlPort = port;
      maybeWriteState();
    },
  });

  // Helper to send current sessions to a specific client
  const sendSessionsSyncToClient = async (socketId: string) => {
    const sessions = await Promise.all(
      sessionWatcher.getActiveSessions().map(sessionFileToData),
    );
    socketServer.sendSessionsSyncToClient(socketId, {
      workstationId,
      sessions,
    });
  };

  // Helper to send all projects to a specific client
  const sendProjectsSyncToClient = (socketId: string) => {
    const projects = projectStore.getAll();
    socketServer.sendProjectsSyncToClient(socketId, {
      workstationId,
      projects,
    });
  };

  // Helper to send messages for a client based on their cursor
  // Sends one batch per session SEQUENTIALLY with flow control (waits for ack before next batch)
  const sendMessagesForClient = async (
    socketId: string,
    cursor: { sessionId: string; lastMessageTs: string }[],
  ) => {
    // Build cursor map for quick lookup
    const cursorMap = new Map(
      cursor.map((c) => [c.sessionId, c.lastMessageTs]),
    );

    // Get all active sessions
    const activeSessions = sessionWatcher.getActiveSessions();

    for (const session of activeSessions) {
      const lastTs = cursorMap.get(session.sessionId) ?? "";
      const lines = jsonlWatcher.getLinesSince(session.sessionId, lastTs);
      const permissionEnvelopes = readLatestPermissionRequestEnvelope(
        session.sessionId,
      );

      const transcriptEnvelopes = linesToEnvelopes(session.sessionId, lines);
      const envelopes = mergeEnvelopesByTimestamp(
        transcriptEnvelopes,
        permissionEnvelopes,
      );

      if (envelopes.length > 0) {
        // Wait for ack before sending next session's batch
        await socketServer.sendMessagesBatchToClientAsync(socketId, {
          workstationId,
          messages: envelopes,
          batchId: randomUUID(),
        });
      }
    }
  };

  // Check if there are any registered clients (from pairing)
  const clientStore = loadClientStore();
  const hasRegisteredClients = Object.keys(clientStore.clients).length > 0;

  if (hasRegisteredClients) {
    console.log(
      `[daemon] Found ${Object.keys(clientStore.clients).length} paired client(s), enabling per-client auth`,
    );
  }

  // Create socket server (all interfaces, for mobile via tunnel)
  const socketServer = new SocketServer({
    workstationId,
    secret: credentials.secret,
    // Enable per-client auth if there are paired clients
    useClientAuth: hasRegisteredClients,
    actionHandlers,
    onConnect: () => {
      // Client will send init, we respond there with proper ordering
    },
    onInit: async (socketId, payload) => {
      // 1. Sessions first (await file I/O)
      await sendSessionsSyncToClient(socketId);

      // 2. Projects second
      sendProjectsSyncToClient(socketId);

      // 3. Messages last - sequential with flow control (waits for ack between batches)
      const cursor = payload.cursor.map((c) => ({
        sessionId: c.sessionId,
        lastMessageTs: c.lastMessageTs,
      }));
      await sendMessagesForClient(socketId, cursor);
    },
    preferredPort: portPrefs?.socketPort,
    onReady: (port) => {
      socketPort = port;
      maybeWriteState();
    },
  });

  // Wire up control server to socket server data
  controlServer.setDataProviders({
    getClientCount: () => socketServer.getConnectedClientsCount(),
    getSessionCount: () => socketServer.getCurrentSessions().length,
    getSessions: () => socketServer.getCurrentSessions(),
    getClients: () => socketServer.getConnectedClients(),
  });

  // Subscribe to eventBus - handle session and message events
  eventBus.on("session:start", (session) => {
    console.log(`[${session.provider}] session:start: ${session.sessionId}`);

    // Start watching the JSONL file for this session
    if (session.transcriptPath) {
      jsonlWatcher.watchSession(session.sessionId, session.transcriptPath);
    }
  });

  eventBus.on("session:end", (sessionId) => {
    console.log(`[daemon] session:end: ${sessionId}`);

    // Stop watching the JSONL file
    jsonlWatcher.unwatchSession(sessionId);
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

    // Broadcast to all connected clients
    const envelopes = linesToEnvelopes(sessionId, lines);
    socketServer.sendMessagesBatch({
      workstationId,
      messages: envelopes,
      batchId: randomUUID(),
    });
  });

  // Handle permission request events - send through messages channel
  eventBus.on("permission:request", (sessionId, event) => {
    console.log(
      `[daemon] permission:request: ${event.toolName} for ${sessionId}`,
    );

    // Send as a RawMessageEnvelope through the messages channel
    // The payload includes type: 'permission_request' so native can detect it
    socketServer.sendMessagesBatch({
      workstationId,
      messages: [
        {
          sessionId,
          payload: event, // SessionEvent with type: 'permission_request'
        },
      ],
      batchId: randomUUID(),
    });
  });

  // Start all watchers and project store
  await Promise.all([
    sessionWatcher.start(),
    claudeWatcher.start(),
    codexWatcher.start(),
    geminiWatcher.start(),
    projectStore.start(),
  ]);

  // Start tunnel if configured (need to wait for socket port)
  let frpcManager: FrpcManager | null = null;

  const startTunnel = async () => {
    if (config.tunnel?.mode === "arc0" && socketPort > 0) {
      frpcManager = await createFrpcManager(config, socketPort, (status) => {
        console.log(
          `[frpc] Status: ${status.status}${status.tunnelUrl ? ` (${status.tunnelUrl})` : ""}`,
        );
      });

      if (frpcManager) {
        const tunnelStatus = frpcManager.getStatus();
        if (tunnelStatus.tunnelUrl) {
          console.log(`[daemon] Tunnel URL: ${tunnelStatus.tunnelUrl}`);
        }
        // Register tunnel stop handler for API
        controlServer.setTunnelStopHandler(async () => {
          if (frpcManager) {
            console.log("[daemon] Tunnel stop requested via API");
            await frpcManager.stop();
            frpcManager = null;
          }
        });
      }
    }
  };

  // Start tunnel after socket server is ready
  if (socketPort > 0) {
    await startTunnel();
  } else {
    // Wait for socket server to be ready, then start tunnel
    const checkAndStartTunnel = setInterval(async () => {
      if (socketPort > 0) {
        clearInterval(checkAndStartTunnel);
        await startTunnel();
      }
    }, 100);
  }

  console.log("[daemon] Ready. Press Ctrl+C to stop.");

  // Graceful shutdown
  const shutdown = async () => {
    console.log("\n[daemon] Shutting down...");

    // Stop tunnel first
    if (frpcManager) {
      await frpcManager.stop();
    }

    sessionWatcher.stop();
    claudeWatcher.stop();
    codexWatcher.stop();
    geminiWatcher.stop();
    jsonlWatcher.stopAll();
    projectStore.stop();

    controlServer.close();
    socketServer.close();
    removeDaemonState();
    await releaseLock();

    console.log("[daemon] Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  console.error("[daemon] Fatal error:", err);
  removeDaemonState();
  process.exit(1);
});
