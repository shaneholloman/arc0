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
} from "@arc0/types";
import type {
  ClientInfo,
  InitPayload,
  SessionCursor,
  SessionData,
  SessionsSyncPayload,
} from "../shared/types.js";
import { safeCompare } from "../shared/credentials.js";
import type { ActionHandlers } from "./actions.js";

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
  onReady?: (port: number) => void;
}

export class ControlServer {
  private httpServer: ReturnType<typeof createServer>;
  private startTime = Date.now();
  private _port = 0;
  private tunnelStopHandler?: () => Promise<void>;

  // References to socket server for status
  private getClientCount: () => number = () => 0;
  private getSessionCount: () => number = () => 0;
  private getSessions: () => SessionData[] = () => [];
  private getClients: () => ClientInfo[] = () => [];

  constructor(options: ControlServerOptions = {}) {
    this.httpServer = createServer((req, res) => this.handleRequest(req, res));

    // Bind to localhost only (port 0 = OS picks)
    this.httpServer.listen(0, "127.0.0.1", () => {
      const addr = this.httpServer.address();
      if (addr && typeof addr === "object") {
        this._port = addr.port;
        console.log(`[control] Listening on 127.0.0.1:${this._port}`);
        options.onReady?.(this._port);
      }
    });
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
  onConnect?: () => void;
  onInit?: (socketId: string, payload: InitPayload) => void;
  actionHandlers?: ActionHandlers;
  onReady?: (port: number) => void;
}

export class SocketServer {
  private httpServer: ReturnType<typeof createServer>;
  private io: Server;
  private clients = new Map<string, ClientInfo>();
  private onConnectCallback?: () => void;
  private onInitCallback?: (socketId: string, payload: InitPayload) => void;
  private currentSessions: SessionData[] = [];
  private workstationId: string;
  private secret?: string;
  private actionHandlers?: ActionHandlers;
  private _port = 0;

  constructor(options: SocketServerOptions) {
    this.workstationId = options.workstationId;
    this.onConnectCallback = options.onConnect;
    this.onInitCallback = options.onInit;
    this.secret = options.secret;
    this.actionHandlers = options.actionHandlers;

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

    // Bind to all interfaces (port 0 = OS picks)
    this.httpServer.listen(0, () => {
      const addr = this.httpServer.address();
      if (addr && typeof addr === "object") {
        this._port = addr.port;
        console.log(`[socket] Listening on 0.0.0.0:${this._port}`);
        options.onReady?.(this._port);
      }
    });
  }

  get port(): number {
    return this._port;
  }

  private setupHandlers(): void {
    // Auth middleware (if secret is configured)
    if (this.secret) {
      const secret = this.secret;
      this.io.use((socket, next) => {
        const clientSecret = socket.handshake.auth?.secret;
        if (typeof clientSecret === "string" && safeCompare(clientSecret, secret)) {
          next();
        } else {
          console.log(`[socket] Auth failed for ${socket.id}`);
          next(new Error("Invalid secret"));
        }
      });
    }

    this.io.on("connection", (socket: Socket) => {
      console.log(`[socket] Client connected: ${socket.id}`);

      // Track client info
      this.clients.set(socket.id, {
        socketId: socket.id,
        deviceId: null,
        connectedAt: new Date(),
        lastAckAt: null,
        cursor: [],
      });

      // Notify daemon of new connection
      this.onConnectCallback?.();

      socket.on("disconnect", (reason) => {
        console.log(`[socket] Client disconnected: ${socket.id} (${reason})`);
        this.clients.delete(socket.id);
      });

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
    });
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

    // sendPrompt
    socket.on("sendPrompt", async (payload: SendPromptPayload, ack: (result: ActionResult) => void) => {
      console.log(`[socket] sendPrompt from ${socket.id}`);
      try {
        const result = await handlers.sendPrompt(payload);
        ack(result);
      } catch (error) {
        console.error("[socket] sendPrompt error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    // approveToolUse (unified handler for tool, plan, and answers)
    socket.on("approveToolUse", async (payload: ApproveToolUsePayload, ack: (result: ActionResult) => void) => {
      console.log(`[socket] approveToolUse from ${socket.id} type=${payload.response.type}`);
      try {
        const result = await handlers.approveToolUse(payload);
        ack(result);
      } catch (error) {
        console.error("[socket] approveToolUse error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    // stopAgent
    socket.on("stopAgent", async (payload: StopAgentPayload, ack: (result: ActionResult) => void) => {
      console.log(`[socket] stopAgent from ${socket.id}`);
      try {
        const result = await handlers.stopAgent(payload);
        ack(result);
      } catch (error) {
        console.error("[socket] stopAgent error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    // openSession
    socket.on("openSession", async (payload: OpenSessionPayload, ack: (result: ActionResult) => void) => {
      console.log(`[socket] openSession from ${socket.id}`);
      try {
        const result = await handlers.openSession(payload);
        ack(result);
      } catch (error) {
        console.error("[socket] openSession error:", error);
        ack({ status: "error", code: "INTERNAL_ERROR", message: String(error) });
      }
    });

    console.log(`[socket] Action handlers registered for ${socket.id}`);
  }

  /**
   * Send sessions to all connected clients.
   */
  sendSessionsSync(payload: SessionsSyncPayload): void {
    // Track current sessions
    this.currentSessions = payload.sessions;

    if (this.clients.size === 0) return;
    this.io.emit("sessions", payload);
    console.log(`[socket] Sent sessions (${payload.sessions.length} sessions)`);
  }

  /**
   * Send projects to all connected clients.
   */
  sendProjectsSync(payload: ProjectsSyncPayload): void {
    if (this.clients.size === 0) return;
    this.io.emit("projects", payload);
    console.log(`[socket] Sent projects (${payload.projects.length} projects)`);
  }

  /**
   * Send messages to all connected clients.
   */
  sendMessagesBatch(payload: RawMessagesBatchPayload): void {
    if (this.clients.size === 0) return;

    this.io.emit("messages", payload, () => {
      // Ack received
    });

    console.log(`[socket] Sent messages (${payload.messages.length} messages, batch=${payload.batchId})`);
  }

  /**
   * Send messages to a specific client.
   */
  sendMessagesBatchToClient(socketId: string, payload: RawMessagesBatchPayload): void {
    const socket = this.io.sockets.sockets.get(socketId);
    if (!socket) return;

    socket.emit("messages", payload, () => {
      const client = this.clients.get(socketId);
      if (client) {
        client.lastAckAt = new Date();
      }
    });

    console.log(`[socket] Sent messages to ${socketId} (${payload.messages.length} messages)`);
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
