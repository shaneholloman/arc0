import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Server, type Socket } from "socket.io";
import type {
  RawMessagesBatchPayload,
  ProjectsSyncPayload,
  SendPromptPayload,
  ApproveToolUsePayload,
  StopAgentPayload,
  OpenSessionPayload,
  ActionResult,
  PairInitPayload,
  PairConfirmPayload,
  EncryptedEnvelope,
} from "@arc0/types";
import { isEncryptedEnvelope } from "@arc0/crypto";
import type {
  ClientInfo,
  InitPayload,
  SessionCursor,
  SessionData,
  SessionsSyncPayload,
} from "../shared/types.js";
import { safeCompare } from "../shared/credentials.js";
import { validateClient, touchClient, getClient } from "../shared/clients.js";
import { pairingManager, type PairingResult } from "./pairing.js";
import {
  registerEncryptionContext,
  removeEncryptionContext,
  encryptForClient,
  decryptFromClient,
  hasEncryptionContext,
} from "./encryption.js";
import { base64ToUint8Array } from "@arc0/crypto";
import type { ActionHandlers } from "./actions.js";
import { MessageQueueManager, type QueuedBatch } from "./message-queue.js";

export interface ServerStatus {
  running: boolean;
  uptime: number;
  clientCount: number;
  sessionCount: number;
}

// =============================================================================
// ControlServer - HTTP API for CLI (localhost only)
// =============================================================================

export interface ControlServerOptions {
  preferredPort?: number;
  onReady?: (port: number) => void;
}

export class ControlServer {
  private httpServer: ReturnType<typeof createServer>;
  private startTime = Date.now();
  private _port = 0;
  private tunnelStopHandler?: () => Promise<void>;
  private pairingCompletedDevice?: { deviceId: string; deviceName: string };

  // References to socket server for status
  private getClientCount: () => number = () => 0;
  private getSessionCount: () => number = () => 0;
  private getSessions: () => SessionData[] = () => [];
  private getClients: () => ClientInfo[] = () => [];

  constructor(options: ControlServerOptions = {}) {
    this.httpServer = createServer((req, res) => this.handleRequest(req, res));

    // Setup pairing completion callback
    pairingManager.onComplete((result: PairingResult) => {
      this.pairingCompletedDevice = {
        deviceId: result.deviceId,
        deviceName: result.deviceName,
      };
    });

    const startListening = (port: number) => {
      this.httpServer.listen(port, "127.0.0.1", () => {
        const addr = this.httpServer.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          console.log(`[control] Listening on 127.0.0.1:${this._port}`);
          options.onReady?.(this._port);
        }
      });
    };

    // Try preferred port first, fall back to OS-assigned port on conflict
    if (options.preferredPort && options.preferredPort > 0) {
      this.httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[control] Preferred port ${options.preferredPort} in use, falling back to OS-assigned`);
          startListening(0);
        } else {
          throw err;
        }
      });
      startListening(options.preferredPort);
    } else {
      startListening(0);
    }
  }

  get port(): number {
    return this._port;
  }

  /**
   * Set references to socket server data for status API.
   */
  setDataProviders(providers: {
    getClientCount: () => number;
    getSessionCount: () => number;
    getSessions: () => SessionData[];
    getClients: () => ClientInfo[];
  }): void {
    this.getClientCount = providers.getClientCount;
    this.getSessionCount = providers.getSessionCount;
    this.getSessions = providers.getSessions;
    this.getClients = providers.getClients;
  }

  /**
   * Set handler for stopping the tunnel (called via API).
   */
  setTunnelStopHandler(handler: () => Promise<void>): void {
    this.tunnelStopHandler = handler;
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader("Content-Type", "application/json");

    if (req.method === "GET" && req.url === "/api/status") {
      const status: ServerStatus = {
        running: true,
        uptime: Math.floor((Date.now() - this.startTime) / 1000),
        clientCount: this.getClientCount(),
        sessionCount: this.getSessionCount(),
      };
      res.writeHead(200);
      res.end(JSON.stringify(status));
      return;
    }

    if (req.method === "GET" && req.url === "/api/clients") {
      const clients = this.getClients().map((c) => ({
        socketId: c.socketId,
        deviceId: c.deviceId,
        connectedAt: c.connectedAt.toISOString(),
        lastAckAt: c.lastAckAt?.toISOString() ?? null,
      }));
      res.writeHead(200);
      res.end(JSON.stringify({ clients }));
      return;
    }

    if (req.method === "GET" && req.url === "/api/sessions") {
      res.writeHead(200);
      res.end(JSON.stringify({ sessions: this.getSessions() }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/tunnel/stop") {
      if (this.tunnelStopHandler) {
        this.tunnelStopHandler()
          .then(() => {
            res.writeHead(200);
            res.end(JSON.stringify({ ok: true }));
          })
          .catch((err) => {
            res.writeHead(500);
            res.end(JSON.stringify({ error: String(err) }));
          });
      } else {
        res.writeHead(200);
        res.end(JSON.stringify({ ok: true, message: "No tunnel running" }));
      }
      return;
    }

    // Pairing API
    if (req.method === "POST" && req.url === "/api/pairing/start") {
      // Clear any previous completion state
      this.pairingCompletedDevice = undefined;
      const { code, formattedCode } = pairingManager.startPairing();
      const expiresIn = pairingManager.getRemainingTime();
      res.writeHead(200);
      res.end(JSON.stringify({ code, formattedCode, expiresIn }));
      console.log(`[control] Started pairing session: ${formattedCode}`);
      return;
    }

    if (req.method === "GET" && req.url === "/api/pairing/status") {
      const active = pairingManager.isPairingActive();
      const code = pairingManager.getActiveCode();
      const remainingMs = pairingManager.getRemainingTime();

      // Check if pairing completed
      if (this.pairingCompletedDevice) {
        const { deviceId, deviceName } = this.pairingCompletedDevice;
        this.pairingCompletedDevice = undefined; // Clear after reading
        res.writeHead(200);
        res.end(JSON.stringify({
          active: false,
          completed: true,
          deviceId,
          deviceName,
        }));
        return;
      }

      res.writeHead(200);
      res.end(JSON.stringify({ active, code, remainingMs, completed: false }));
      return;
    }

    if (req.method === "POST" && req.url === "/api/pairing/cancel") {
      pairingManager.cancelPairing();
      this.pairingCompletedDevice = undefined;
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  }

  close(): void {
    this.httpServer.close();
  }
}

// =============================================================================
// SocketServer - Socket.IO for mobile (exposed via tunnel)
// =============================================================================

export interface SocketServerOptions {
  workstationId: string;
  secret?: string;
  /** If true, require per-client token auth instead of shared secret */
  useClientAuth?: boolean;
  onConnect?: () => void;
  onInit?: (socketId: string, payload: InitPayload) => void | Promise<void>;
  actionHandlers?: ActionHandlers;
  preferredPort?: number;
  onReady?: (port: number) => void;
}

export class SocketServer {
  private httpServer: ReturnType<typeof createServer>;
  private io: Server;
  private clients = new Map<string, ClientInfo>();
  private authenticatedSockets = new Set<string>();
  private onConnectCallback?: () => void;
  private onInitCallback?: (socketId: string, payload: InitPayload) => void | Promise<void>;
  private currentSessions: SessionData[] = [];
  private workstationId: string;
  private secret?: string;
  private useClientAuth: boolean;
  private actionHandlers?: ActionHandlers;
  private _port = 0;
  private messageQueue: MessageQueueManager;

  constructor(options: SocketServerOptions) {
    this.workstationId = options.workstationId;
    this.onConnectCallback = options.onConnect;
    this.onInitCallback = options.onInit;
    this.secret = options.secret;
    this.useClientAuth = options.useClientAuth ?? false;
    this.actionHandlers = options.actionHandlers;

    // Initialize message queue for flow control
    this.messageQueue = new MessageQueueManager((socketId, payload, encrypted, onAck) =>
      this.emitMessage(socketId, payload, encrypted, onAck)
    );

    // Create HTTP server for Socket.IO
    this.httpServer = createServer();

    // Attach Socket.IO to HTTP server
    this.io = new Server(this.httpServer, {
      cors: {
        origin: "*", // Allow all origins (tunnel connections)
        methods: ["GET", "POST"],
      },
    });

    this.setupHandlers();

    const startListening = (port: number) => {
      this.httpServer.listen(port, () => {
        const addr = this.httpServer.address();
        if (addr && typeof addr === "object") {
          this._port = addr.port;
          console.log(`[socket] Listening on 0.0.0.0:${this._port}`);
          options.onReady?.(this._port);
        }
      });
    };

    // Try preferred port first, fall back to OS-assigned port on conflict
    if (options.preferredPort && options.preferredPort > 0) {
      this.httpServer.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code === "EADDRINUSE") {
          console.log(`[socket] Preferred port ${options.preferredPort} in use, falling back to OS-assigned`);
          startListening(0);
        } else {
          throw err;
        }
      });
      startListening(options.preferredPort);
    } else {
      startListening(0);
    }
  }

  get port(): number {
    return this._port;
  }

  private setupHandlers(): void {
    // Auth middleware - allow all connections initially, but track authenticated ones
    this.io.use((socket, next) => {
      const auth = socket.handshake.auth;

      // Check for per-client token auth (new E2E encryption mode)
      if (this.useClientAuth) {
        const deviceId = auth?.deviceId;
        const authToken = auth?.authToken;

        if (typeof deviceId === "string" && typeof authToken === "string") {
          if (validateClient(deviceId, authToken)) {
            (socket as Socket & { authenticated: boolean; deviceId: string }).authenticated = true;
            (socket as Socket & { deviceId: string }).deviceId = deviceId;
            touchClient(deviceId);
            console.log(`[socket] Authenticated client: ${deviceId}`);
            next();
            return;
          }
        }

        // Allow unauthenticated for pairing
        (socket as Socket & { authenticated: boolean }).authenticated = false;
        next();
        return;
      }

      // Legacy: shared secret auth
      if (this.secret) {
        const clientSecret = auth?.secret;
        if (typeof clientSecret === "string" && safeCompare(clientSecret, this.secret)) {
          (socket as Socket & { authenticated: boolean }).authenticated = true;
          next();
          return;
        }
      }

      // No auth configured or pairing mode - allow connection
      (socket as Socket & { authenticated: boolean }).authenticated = !this.secret && !this.useClientAuth;
      next();
    });

    this.io.on("connection", (socket: Socket) => {
      const isAuthenticated = (socket as Socket & { authenticated?: boolean }).authenticated ?? false;
      const deviceId = (socket as Socket & { deviceId?: string }).deviceId;

      console.log(`[socket] Client connected: ${socket.id} (authenticated: ${isAuthenticated})`);

      // Track authenticated sockets
      if (isAuthenticated) {
        this.authenticatedSockets.add(socket.id);

        // Register encryption context if using per-client auth
        if (this.useClientAuth && deviceId) {
          const client = getClient(deviceId);
          if (client?.encryptionKey) {
            const keyBytes = base64ToUint8Array(client.encryptionKey);
            registerEncryptionContext(socket.id, deviceId, keyBytes);
          }
        }
      }

      // Track client info
      this.clients.set(socket.id, {
        socketId: socket.id,
        deviceId: deviceId ?? null,
        connectedAt: new Date(),
        lastAckAt: null,
        cursor: [],
      });

      // Notify daemon of new connection
      this.onConnectCallback?.();

      socket.on("disconnect", (reason) => {
        console.log(`[socket] Client disconnected: ${socket.id} (${reason})`);
        this.clients.delete(socket.id);
        this.authenticatedSockets.delete(socket.id);
        removeEncryptionContext(socket.id);
        this.messageQueue.onDisconnect(socket.id);
      });

      // Setup pairing handlers (always available)
      this.setupPairingHandlers(socket);

      // Only setup authenticated handlers if authenticated
      if (isAuthenticated) {
        this.setupAuthenticatedHandlers(socket);
      }
    });
  }

  /**
   * Setup pairing event handlers (unauthenticated).
   */
  private setupPairingHandlers(socket: Socket): void {
    // Handle pair:init
    socket.on("pair:init", (payload: PairInitPayload) => {
      console.log(`[socket] pair:init from ${socket.id} device=${payload.deviceId}`);

      const result = pairingManager.handlePairInit(payload);

      if ("error" in result) {
        socket.emit("pair:error", result.error);
        return;
      }

      socket.emit("pair:challenge", result.challenge);
    });

    // Handle pair:confirm
    socket.on("pair:confirm", (payload: PairConfirmPayload) => {
      console.log(`[socket] pair:confirm from ${socket.id}`);

      const result = pairingManager.handlePairConfirm(payload.mac);

      if ("error" in result) {
        socket.emit("pair:error", result.error);
        return;
      }

      socket.emit("pair:complete", result.complete);
      console.log(`[socket] Pairing complete for ${socket.id}`);
    });
  }

  /**
   * Setup authenticated event handlers.
   */
  private setupAuthenticatedHandlers(socket: Socket): void {
    // Handle init (sent immediately after connect)
    socket.on("init", (payload: InitPayload) => {
      console.log(`[socket] Init: ${socket.id} device=${payload.deviceId} cursors=${payload.cursor.length}`);
      const client = this.clients.get(socket.id);
      if (client) {
        client.deviceId = payload.deviceId;
        client.cursor = payload.cursor;
      }
      this.onInitCallback?.(socket.id, payload);
    });

    // Handle client requests (lightweight connection test)
    socket.on("ping", (callback) => {
      if (typeof callback === "function") {
        callback({ pong: true, workstationId: this.workstationId, timestamp: Date.now() });
      }
    });

    // Handle user actions (with ack callbacks)
    this.setupActionHandlers(socket);
  }

  /**
   * Setup action handlers for a connected socket.
   */
  private setupActionHandlers(socket: Socket): void {
    if (!this.actionHandlers) {
      console.log("[socket] No action handlers configured, skipping action setup");
      return;
    }

    const handlers = this.actionHandlers;
    const useEncryption = this.useClientAuth && hasEncryptionContext(socket.id);

    // Helper to decrypt incoming payload if encrypted
    const decryptPayload = <T>(payload: unknown): T | null => {
      if (!useEncryption) {
        return payload as T;
      }
      if (isEncryptedEnvelope(payload)) {
        return decryptFromClient<T>(socket.id, payload);
      }
      // Not encrypted - might be legacy client
      return payload as T;
    };

    // sendPrompt
    socket.on("sendPrompt", async (payload: SendPromptPayload | EncryptedEnvelope, ack: (result: ActionResult) => void) => {
      console.log(`[socket] sendPrompt from ${socket.id}`);
      try {
        const decrypted = decryptPayload<SendPromptPayload>(payload);
        if (!decrypted) {
          ack({ status: "error", code: "DECRYPT_ERROR", message: "Failed to decrypt payload" });
          return;
        }
        const result = await handlers.sendPrompt(decrypted);
        ack(result);
      } catch (error) {
        console.error("[socket] sendPrompt error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    // approveToolUse (unified handler for tool, plan, and answers)
    socket.on("approveToolUse", async (payload: ApproveToolUsePayload | EncryptedEnvelope, ack: (result: ActionResult) => void) => {
      try {
        const decrypted = decryptPayload<ApproveToolUsePayload>(payload);
        if (!decrypted) {
          ack({ status: "error", code: "DECRYPT_ERROR", message: "Failed to decrypt payload" });
          return;
        }
        console.log(`[socket] approveToolUse from ${socket.id} type=${decrypted.response.type}`);
        const result = await handlers.approveToolUse(decrypted);
        ack(result);
      } catch (error) {
        console.error("[socket] approveToolUse error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    // stopAgent
    socket.on("stopAgent", async (payload: StopAgentPayload | EncryptedEnvelope, ack: (result: ActionResult) => void) => {
      console.log(`[socket] stopAgent from ${socket.id}`);
      try {
        const decrypted = decryptPayload<StopAgentPayload>(payload);
        if (!decrypted) {
          ack({ status: "error", code: "DECRYPT_ERROR", message: "Failed to decrypt payload" });
          return;
        }
        const result = await handlers.stopAgent(decrypted);
        ack(result);
      } catch (error) {
        console.error("[socket] stopAgent error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    // openSession
    socket.on("openSession", async (payload: OpenSessionPayload | EncryptedEnvelope, ack: (result: ActionResult) => void) => {
      console.log(`[socket] openSession from ${socket.id}`);
      try {
        const decrypted = decryptPayload<OpenSessionPayload>(payload);
        if (!decrypted) {
          ack({ status: "error", code: "DECRYPT_ERROR", message: "Failed to decrypt payload" });
          return;
        }
        const result = await handlers.openSession(decrypted);
        ack(result);
      } catch (error) {
        console.error("[socket] openSession error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    console.log(`[socket] Action handlers registered for ${socket.id} (encryption: ${useEncryption})`);
  }

  /**
   * Emit a message to a socket with encryption support. Returns false if socket not found.
   */
  private emitMessage(
    socketId: string,
    payload: RawMessagesBatchPayload,
    encrypted: boolean,
    onAck: () => void
  ): boolean {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) return false;

    const updateLastAck = () => {
      const client = this.clients.get(socketId);
      if (client) {
        client.lastAckAt = new Date();
      }
      onAck();
    };

    if (encrypted && this.useClientAuth && hasEncryptionContext(socketId)) {
      const encryptedPayload = encryptForClient(socketId, payload);
      if (encryptedPayload) {
        socket.emit("messages", encryptedPayload, updateLastAck);
        return true;
      }
      return false;
    } else {
      socket.emit("messages", payload as unknown as EncryptedEnvelope, updateLastAck);
      return true;
    }
  }

  /**
   * Send sessions to all connected clients (encrypted if applicable).
   */
  sendSessionsSync(payload: SessionsSyncPayload): void {
    // Track current sessions
    this.currentSessions = payload.sessions;

    if (this.clients.size === 0) return;

    // Send to each authenticated client with encryption if available
    for (const socketId of this.authenticatedSockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) continue;

      if (this.useClientAuth && hasEncryptionContext(socketId)) {
        const encrypted = encryptForClient(socketId, payload);
        if (encrypted) {
          socket.emit("sessions", encrypted);
        }
      } else {
        socket.emit("sessions", payload as unknown as EncryptedEnvelope);
      }
    }

    console.log(`[socket] Sent sessions (${payload.sessions.length} sessions)`);
  }

  /**
   * Send projects to all connected clients (encrypted if applicable).
   */
  sendProjectsSync(payload: ProjectsSyncPayload): void {
    if (this.clients.size === 0) return;

    // Send to each authenticated client with encryption if available
    for (const socketId of this.authenticatedSockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) continue;

      if (this.useClientAuth && hasEncryptionContext(socketId)) {
        const encrypted = encryptForClient(socketId, payload);
        if (encrypted) {
          socket.emit("projects", encrypted);
        }
      } else {
        socket.emit("projects", payload as unknown as EncryptedEnvelope);
      }
    }

    console.log(`[socket] Sent projects (${payload.projects.length} projects)`);
  }

  /**
   * Send sessions to a specific client (encrypted if applicable).
   */
  sendSessionsSyncToClient(socketId: string, payload: SessionsSyncPayload): void {
    this.currentSessions = payload.sessions;

    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket || !this.authenticatedSockets.has(socketId)) return;

    if (this.useClientAuth && hasEncryptionContext(socketId)) {
      const encrypted = encryptForClient(socketId, payload);
      if (encrypted) {
        socket.emit("sessions", encrypted);
      }
    } else {
      socket.emit("sessions", payload as unknown as EncryptedEnvelope);
    }

    console.log(`[socket] Sent sessions to ${socketId} (${payload.sessions.length} sessions)`);
  }

  /**
   * Send projects to a specific client (encrypted if applicable).
   */
  sendProjectsSyncToClient(socketId: string, payload: ProjectsSyncPayload): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket || !this.authenticatedSockets.has(socketId)) return;

    if (this.useClientAuth && hasEncryptionContext(socketId)) {
      const encrypted = encryptForClient(socketId, payload);
      if (encrypted) {
        socket.emit("projects", encrypted);
      }
    } else {
      socket.emit("projects", payload as unknown as EncryptedEnvelope);
    }

    console.log(`[socket] Sent projects to ${socketId} (${payload.projects.length} projects)`);
  }

  /**
   * Send messages to all connected clients (queued with flow control).
   */
  sendMessagesBatch(payload: RawMessagesBatchPayload): void {
    if (this.clients.size === 0) return;

    // Queue for each authenticated client
    for (const socketId of this.authenticatedSockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) continue;

      const encrypted = this.useClientAuth && hasEncryptionContext(socketId);
      this.messageQueue.enqueue(socketId, { payload, encrypted });
    }

    console.log(`[socket] Queued messages (${payload.messages.length} messages, batch=${payload.batchId})`);
  }

  /**
   * Send messages to a specific client (queued with flow control).
   */
  sendMessagesBatchToClient(socketId: string, payload: RawMessagesBatchPayload): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) return;

    const encrypted = this.useClientAuth && hasEncryptionContext(socketId);
    this.messageQueue.enqueue(socketId, { payload, encrypted });

    console.log(`[socket] Queued messages to ${socketId} (${payload.messages.length} messages)`);
  }

  /**
   * Send messages to a specific client and wait for ack (for sequential init flow).
   */
  sendMessagesBatchToClientAsync(socketId: string, payload: RawMessagesBatchPayload): Promise<void> {
    return new Promise((resolve) => {
      const socket = this.io.sockets.sockets.get(socketId);
      if (!socket) {
        resolve();
        return;
      }

      const encrypted = this.useClientAuth && hasEncryptionContext(socketId);
      this.messageQueue.enqueue(socketId, { payload, encrypted, resolve });
    });
  }

  /**
   * Update client's deviceId (from BatchAck).
   */
  updateClientDeviceId(socketId: string, deviceId: string): void {
    const client = this.clients.get(socketId);
    if (client) {
      client.deviceId = deviceId;
      client.lastAckAt = new Date();
    }
  }

  /**
   * Get client's cursor for a specific session.
   */
  getClientCursor(socketId: string, sessionId: string): SessionCursor | null {
    const client = this.clients.get(socketId);
    return client?.cursor.find((c) => c.sessionId === sessionId) ?? null;
  }

  getConnectedClients(): ClientInfo[] {
    return Array.from(this.clients.values());
  }

  getConnectedClientsCount(): number {
    return this.clients.size;
  }

  getCurrentSessions(): SessionData[] {
    return this.currentSessions;
  }

  close(): void {
    this.messageQueue.stop();
    this.io.close();
    this.httpServer.close();
  }

  getStatus(): ServerStatus {
    return {
      running: true,
      uptime: 0, // Uptime tracked by control server
      clientCount: this.clients.size,
      sessionCount: this.currentSessions.length,
    };
  }
}
