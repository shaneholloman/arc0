import { randomUUID } from "node:crypto";
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
function linesToEnvelopes(sessionId: string, lines: StoredLine[]): RawMessageEnvelope[] {
  return lines.map((line) => ({
    sessionId,
    payload: line.raw,
  }));
}

async function main() {
  // Load config
  const config = loadConfig();
  if (!config?.workstationId) {
    console.error("[daemon] Config not found or missing workstationId. Run 'arc0 init' first.");
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
    console.error(`[daemon] Another daemon is already running (PID: ${state?.pid}, control: ${state?.controlPort}, socket: ${state?.socketPort})`);
    console.error("[daemon] Use 'arc0 stop' to stop it first, or 'arc0 status' to check its status.");
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
      return sessionWatcher.getActiveSessions().find((s) => s.sessionId === sessionId);
    },
  });

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
      console.log(`[daemon] State written (control: ${controlPort}, socket: ${socketPort})`);
    }
  };

  // Create control server (localhost only, for CLI)
  const controlServer = new ControlServer({
    onReady: (port) => {
      controlPort = port;
      maybeWriteState();
    },
  });

  // Helper to send current sessions
  const sendSessionsSync = async () => {
    const sessions = await Promise.all(
      sessionWatcher.getActiveSessions().map(sessionFileToData)
    );
    socketServer.sendSessionsSync({ workstationId, sessions });
  };

  // Helper to send all projects
  const sendProjectsSync = () => {
    const projects = projectStore.getAll();
    socketServer.sendProjectsSync({ workstationId, projects });
  };

  // Helper to send messages for a client based on their cursor
  const sendMessagesForClient = (socketId: string, cursor: { sessionId: string; lastMessageTs: string }[]) => {
    // Build cursor map for quick lookup
    const cursorMap = new Map(cursor.map((c) => [c.sessionId, c.lastMessageTs]));

    // Get all active sessions
    const activeSessions = sessionWatcher.getActiveSessions();
    const allMessages: RawMessageEnvelope[] = [];

    for (const session of activeSessions) {
      const lastTs = cursorMap.get(session.sessionId) ?? "";
      const lines = jsonlWatcher.getLinesSince(session.sessionId, lastTs);

      if (lines.length > 0) {
        allMessages.push(...linesToEnvelopes(session.sessionId, lines));
      }
    }

    if (allMessages.length > 0) {
      socketServer.sendMessagesBatchToClient(socketId, {
        workstationId,
        messages: allMessages,
        batchId: randomUUID(),
      });
    }
  };

  // Check if there are any registered clients (from pairing)
  const clientStore = loadClientStore();
  const hasRegisteredClients = Object.keys(clientStore.clients).length > 0;

  if (hasRegisteredClients) {
    console.log(`[daemon] Found ${Object.keys(clientStore.clients).length} paired client(s), enabling per-client auth`);
  }

  // Create socket server (all interfaces, for mobile via tunnel)
  const socketServer = new SocketServer({
    workstationId,
    secret: credentials.secret,
    // Enable per-client auth if there are paired clients
    useClientAuth: hasRegisteredClients,
    actionHandlers,
    onConnect: () => {
      // Send current sessions and projects to newly connected client
      sendSessionsSync();
      sendProjectsSync();
    },
    onInit: (socketId, payload) => {
      // Client sent init with cursor - send messages since their cursor
      const cursor = payload.cursor.map((c) => ({
        sessionId: c.sessionId,
        lastMessageTs: c.lastMessageTs,
      }));
      sendMessagesForClient(socketId, cursor);
    },
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
    console.log(`[daemon] messages:new: ${lines.length} lines for ${sessionId}`);

    // Broadcast to all connected clients
    const envelopes = linesToEnvelopes(sessionId, lines);
    socketServer.sendMessagesBatch({
      workstationId,
      messages: envelopes,
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
        console.log(`[frpc] Status: ${status.status}${status.tunnelUrl ? ` (${status.tunnelUrl})` : ""}`);
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
