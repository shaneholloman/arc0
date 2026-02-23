import type { Arc0Config } from "../../lib/config.js";
import {
  acquireDaemonLock,
  ensureCredentials,
  getPreferredPorts,
  loadConfig,
  readDaemonState,
  removeDaemonState,
  savePreferredPorts,
  VERSION,
  writeDaemonState,
} from "../../lib/index.js";

import { ControlServer, SocketServer } from "../../socket/server.js";
import { createActionHandlers } from "../../socket/actions.js";
import { jsonlWatcher } from "../../transcript/index.js";
import { createFrpcManager, type FrpcManager } from "../frpc-manager.js";
import { projectStore } from "../projects/index.js";
import { SessionFileWatcher } from "../session-files/watcher.js";
import { registerDaemonEventHandlers } from "./event-handlers.js";
import { sessionFileToData } from "./session-data.js";
import {
  sendMessagesForClient,
  sendProjectsSyncToClient,
  sendSessionsSyncToClient,
} from "./sync.js";

const TUNNEL_START_POLL_INTERVAL_MS = 100;

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

  // Ensure credentials exist (generates keys on first run)
  ensureCredentials();
  console.log(`[daemon] Credentials loaded`);

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

  // Create socket server (all interfaces, for mobile via tunnel)
  const socketServer = new SocketServer({
    workstationId,
    actionHandlers,
    onConnect: () => {
      // Client will send init, we respond there with proper ordering
    },
    onInit: async (socketId, payload) => {
      // 1. Sessions first (await file I/O)
      await sendSessionsSyncToClient({
        socketServer,
        sessionWatcher,
        workstationId,
        sessionFileToData,
        socketId,
      });

      // 2. Projects second
      sendProjectsSyncToClient({
        socketServer,
        workstationId,
        socketId,
      });

      // 3. Messages last - sequential with flow control (waits for ack between batches)
      await sendMessagesForClient({
        socketServer,
        sessionWatcher,
        workstationId,
        cursor: payload.cursor,
        socketId,
      });
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

  registerDaemonEventHandlers({
    sessionWatcher,
    socketServer,
    workstationId,
  });

  // Start all watchers and project store
  await Promise.all([sessionWatcher.start(), projectStore.start()]);

  // Start tunnel if configured (need to wait for socket port)
  let frpcManager: FrpcManager | null = null;

  const startTunnel = async (runtimeConfig: Arc0Config) => {
    if (runtimeConfig.tunnel?.mode === "arc0" && socketPort > 0) {
      frpcManager = await createFrpcManager(
        runtimeConfig,
        socketPort,
        (status) => {
          console.log(
            `[frpc] Status: ${status.status}${status.tunnelUrl ? ` (${status.tunnelUrl})` : ""}`,
          );
        },
      );

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
    await startTunnel(config);
  } else {
    // Wait for socket server to be ready, then start tunnel
    const checkAndStartTunnel = setInterval(async () => {
      if (socketPort > 0) {
        clearInterval(checkAndStartTunnel);
        await startTunnel(config);
      }
    }, TUNNEL_START_POLL_INTERVAL_MS);
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

/**
 * Run the Arc0 daemon (Base runtime).
 */
export async function runDaemon(): Promise<void> {
  try {
    await main();
  } catch (err) {
    console.error("[daemon] Fatal error:", err);
    removeDaemonState();
    process.exit(1);
  }
}
