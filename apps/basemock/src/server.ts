/**
 * Socket.IO server for BaseMock CLI.
 * Simulates the Base service for testing mobile app integration.
 */

import { Server, Socket } from "socket.io";
import { createServer, Server as HttpServer } from "http";
import { randomUUID, timingSafeEqual } from "crypto";
import type {
  JSONLPayload,
  MessagesBatchPayload,
  MockSession,
  RawMessageEnvelope,
  ServerState,
  SessionsSyncPayload,
  ClientInfo,
  InitPayload,
  ActionResult,
  OpenSessionPayload,
  SendPromptPayload,
  StopAgentPayload,
  ApproveToolUsePayload,
} from "./types.js";
export type { ClientInfo };
import {
  createMockSession,
  sessionToSessionData,
  createToolResult,
} from "./mocks.js";
import { logger } from "./logger.js";

// Track pending tool approvals for sending tool_result after approval
interface PendingToolApproval {
  sessionId: string;
  command: string;
  parentUuid: string;
}
let pendingToolApprovals: Map<string, PendingToolApproval> = new Map();

// =============================================================================
// Server State
// =============================================================================

const state: ServerState = {
  workstationId: `workstation-${randomUUID().slice(0, 8)}`,
  sessions: new Map(),
  currentSessionId: null,
};

let io: Server | null = null;
let httpServer: HttpServer | null = null;
let connectedClients: Map<string, Socket> = new Map();

// Track client info (device_id from init, cursor for sync)
let clientInfoMap: Map<string, ClientInfo> = new Map();

// Flag to make next tool approval return an error (for testing)
let pendingToolApprovalError = false;

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Timing-safe string comparison to prevent timing attacks.
 */
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// =============================================================================
// Server Lifecycle
// =============================================================================

export interface StartServerOptions {
  port?: number;
  secret?: string;
}

export function startServer(options: StartServerOptions = {}): Promise<void> {
  const { port = 3001, secret } = options;
  return new Promise((resolve, reject) => {
    if (io) {
      reject(new Error("Server already running"));
      return;
    }

    httpServer = createServer();
    io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    // Auth middleware (if secret is configured)
    if (secret) {
      io.use((socket, next) => {
        const clientSecret = socket.handshake.auth?.secret;
        if (
          typeof clientSecret === "string" &&
          safeCompare(clientSecret, secret)
        ) {
          next();
        } else {
          logger.warn("Auth failed", socket.id.slice(0, 8));
          next(new Error("Invalid secret"));
        }
      });
    }

    io.on("connection", (socket) => {
      logger.info("Client connected", socket.id.slice(0, 8));
      connectedClients.set(socket.id, socket);
      clientInfoMap.set(socket.id, {
        socketId: socket.id,
        deviceId: null,
        connectedAt: new Date(),
        lastAckAt: null,
        cursor: [],
      });

      // Handle init event (sent by mobile on connect with device ID and cursors)
      socket.on("init", (payload: InitPayload) => {
        const clientInfo = clientInfoMap.get(socket.id);
        if (clientInfo) {
          clientInfo.deviceId = payload.deviceId;
          clientInfo.cursor = payload.cursor;
        }
        logger.info(
          "Client init",
          `device=${payload.deviceId} cursors=${payload.cursor.length}`,
        );

        // Send current sessions after init
        if (state.sessions.size > 0) {
          sendSessionsSync();
        }
      });

      socket.on("disconnect", (reason) => {
        logger.info(
          "Client disconnected",
          `${socket.id.slice(0, 8)} (${reason})`,
        );
        connectedClients.delete(socket.id);
        clientInfoMap.delete(socket.id);
      });

      // Lightweight ping for connection testing (no full init/sessions sync)
      socket.on(
        "ping",
        (
          callback: (response: {
            pong: boolean;
            workstationId: string;
            timestamp: number;
          }) => void,
        ) => {
          if (typeof callback === "function") {
            callback({
              pong: true,
              workstationId: state.workstationId,
              timestamp: Date.now(),
            });
          }
        },
      );

      // ==========================================================================
      // User Action Handlers
      // ==========================================================================

      // Handler for openSession action
      socket.on(
        "openSession",
        async (
          payload: OpenSessionPayload,
          ack: (result: ActionResult) => void,
        ) => {
          logger.info(
            "openSession",
            `provider=${payload.provider} name=${payload.name ?? "unnamed"}`,
          );

          // Simulate delay
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // Create a new session
          const session = createSession(payload.name ?? undefined);
          logger.info("Created session", session.id.slice(0, 8));

          // Send sessions sync to update clients
          sendSessionsSync();

          // Return success with the new session ID
          ack({
            status: "success",
            sessionId: session.id,
            message: "Session created successfully",
          });
        },
      );

      // Handler for sendPrompt action
      socket.on(
        "sendPrompt",
        async (
          payload: SendPromptPayload,
          ack: (result: ActionResult) => void,
        ) => {
          logger.info(
            "sendPrompt",
            `session=${payload.sessionId.slice(0, 8)} model=${payload.model} mode=${payload.mode}`,
          );
          logger.info(
            "  text",
            payload.text.slice(0, 50) + (payload.text.length > 50 ? "..." : ""),
          );

          // Simulate delay
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // Return success
          ack({
            status: "success",
            message: "Prompt received",
          });
        },
      );

      // Handler for stopAgent action
      socket.on(
        "stopAgent",
        async (
          payload: StopAgentPayload,
          ack: (result: ActionResult) => void,
        ) => {
          logger.info("stopAgent", `session=${payload.sessionId.slice(0, 8)}`);

          // Simulate delay
          await new Promise((resolve) => setTimeout(resolve, 3000));

          // Return success
          ack({
            status: "success",
            message: "Agent stopped",
          });
        },
      );

      // Handler for approveToolUse action (unified handler for tool, plan, and answers)
      socket.on(
        "approveToolUse",
        async (
          payload: ApproveToolUsePayload,
          ack: (result: ActionResult) => void,
        ) => {
          const { response } = payload;
          logger.info(
            "approveToolUse",
            `session=${payload.sessionId.slice(0, 8)} tool=${payload.toolName} type=${response.type}`,
          );
          logger.info("  toolUseId", payload.toolUseId);

          switch (response.type) {
            case "tool": {
              const optionLabels: Record<number, string> = {
                1: "approve-once",
                2: "approve-always",
                3: "reject",
              };
              logger.info(
                "  option",
                optionLabels[response.option] || `unknown(${response.option})`,
              );
              break;
            }
            case "plan": {
              const planLabels: Record<number, string> = {
                1: "clear-bypass",
                2: "manual",
                3: "bypass",
                4: "keep-manual",
                5: "feedback",
              };
              logger.info(
                "  option",
                planLabels[response.option] || `unknown(${response.option})`,
              );
              if (response.text) {
                logger.info(
                  "  text",
                  response.text.slice(0, 50) +
                    (response.text.length > 50 ? "..." : ""),
                );
              }
              break;
            }
            case "answers": {
              logger.info("  answers", `${response.answers.length} answers`);
              response.answers.forEach((answer, i) => {
                logger.info(
                  `    [${i}]`,
                  `q${answer.questionIndex} opt=${answer.option}${answer.text ? ` text="${answer.text}"` : ""}`,
                );
              });
              break;
            }
          }

          // Simulate delay
          await new Promise((resolve) => setTimeout(resolve, 1000));

          // Check if we should return an error (configurable via pendingToolApprovalError)
          if (pendingToolApprovalError) {
            pendingToolApprovalError = false; // Reset after use
            ack({
              status: "error",
              code: "TOOL_APPROVAL_FAILED",
              message: "Failed to process tool approval",
            });
            return;
          }

          // Return success ack first
          const isRejected = response.type === "tool" && response.option === 3;
          ack({
            status: "success",
            message: isRejected ? "Tool rejected" : "Response received",
          });

          // Look up the pending approval to send tool_result (only for 'tool' type)
          if (response.type === "tool") {
            logger.info(
              "Looking up pending approval",
              `toolUseId=${payload.toolUseId} found=${pendingToolApprovals.has(payload.toolUseId)}`,
            );
            const pendingApproval = pendingToolApprovals.get(payload.toolUseId);
            if (pendingApproval) {
              pendingToolApprovals.delete(payload.toolUseId);

              // Small delay to simulate tool execution
              await new Promise((resolve) => setTimeout(resolve, 500));

              // Send tool_result based on approval option
              let resultContent: string;
              let isError = false;

              if (response.option === 3) {
                // Rejected
                resultContent = "Tool execution was rejected by user";
                isError = true;
              } else {
                // Approved (once or always) - simulate successful execution
                resultContent = `Command executed successfully:\n$ ${pendingApproval.command}\n\nExit code: 0`;
              }

              const toolResultMsg = createToolResult(
                pendingApproval.sessionId,
                payload.toolUseId,
                resultContent,
                isError,
                pendingApproval.parentUuid,
              );

              await sendMessagesBatch(pendingApproval.sessionId, [
                toolResultMsg,
              ]);
              logger.success(
                "Tool result sent",
                isError ? "(rejected)" : "(success)",
              );
            }
          }
        },
      );
    });

    httpServer.listen(port, () => {
      resolve();
    });

    httpServer.on("error", (err) => {
      reject(err);
    });
  });
}

export function stopServer(): Promise<void> {
  return new Promise((resolve) => {
    if (io) {
      io.close(() => {
        io = null;
        httpServer = null;
        connectedClients.clear();
        clientInfoMap.clear();
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export function isServerRunning(): boolean {
  return io !== null;
}

export function getConnectedClientCount(): number {
  return connectedClients.size;
}

export function getConnectedClients(): ClientInfo[] {
  return Array.from(clientInfoMap.values());
}

// =============================================================================
// Session Management
// =============================================================================

export function createSession(name?: string): MockSession {
  const session = createMockSession({
    name: name ?? null,
  });
  state.sessions.set(session.id, session);
  state.currentSessionId = session.id;
  return session;
}

export function closeSession(sessionId: string): void {
  const session = state.sessions.get(sessionId);
  if (session) {
    session.open = false;
  }
}

export function getCurrentSession(): MockSession | null {
  if (!state.currentSessionId) {
    return null;
  }
  return state.sessions.get(state.currentSessionId) ?? null;
}

export function setCurrentSession(sessionId: string): boolean {
  if (state.sessions.has(sessionId)) {
    state.currentSessionId = sessionId;
    return true;
  }
  return false;
}

export function getOpenSessions(): MockSession[] {
  return Array.from(state.sessions.values()).filter((s) => s.open);
}

export function getAllSessions(): MockSession[] {
  return Array.from(state.sessions.values());
}

// =============================================================================
// Event Emission
// =============================================================================

export function sendSessionsSync(): void {
  if (!io) {
    logger.warn("Cannot send sessions", "Server not running");
    return;
  }

  const openSessions = getOpenSessions();
  const payload: SessionsSyncPayload = {
    workstationId: state.workstationId,
    sessions: openSessions.map(sessionToSessionData),
  };

  io.emit("sessions", payload);
}

/**
 * Send a batch of messages to all connected clients.
 * @param sessionId - The session these messages belong to
 * @param messages - Raw JSONL payloads to send (conversation or metadata messages)
 */
export async function sendMessagesBatch(
  sessionId: string,
  messages: JSONLPayload[],
): Promise<void> {
  if (!io) {
    logger.warn("Cannot send messages", "Server not running");
    return;
  }

  // Wrap messages as raw envelopes (matching Base service format)
  // sessionId is in the envelope, not in the JSONL payload
  const envelopes: RawMessageEnvelope[] = messages.map((msg) => ({
    sessionId,
    payload: msg, // Send the full raw JSONL message as payload
  }));

  const payload: MessagesBatchPayload = {
    workstationId: state.workstationId,
    messages: envelopes,
    batchId: randomUUID(),
  };

  // Send to all connected clients with simple ack callback
  const promises = Array.from(connectedClients.values()).map(
    (socket) =>
      new Promise<void>((resolve) => {
        socket.timeout(5000).emit("messages", payload, (err: Error | null) => {
          if (err) {
            logger.error("Ack timeout", socket.id.slice(0, 8));
          } else {
            // Update lastAckAt on successful ack
            const clientInfo = clientInfoMap.get(socket.id);
            if (clientInfo) {
              clientInfo.lastAckAt = new Date();
            }
            logger.info("Received ack", socket.id.slice(0, 8));
          }
          resolve();
        });
      }),
  );

  await Promise.all(promises);
}

// =============================================================================
// State Access
// =============================================================================

export function getWorkstationId(): string {
  return state.workstationId;
}

// =============================================================================
// Test Helpers
// =============================================================================

/**
 * Set the next tool approval response to return an error.
 * The flag is automatically reset after one use.
 */
export function setNextToolApprovalError(shouldError: boolean): void {
  pendingToolApprovalError = shouldError;
}

/**
 * Register a pending tool approval so we can send tool_result when approved.
 */
export function registerPendingToolApproval(
  toolUseId: string,
  sessionId: string,
  command: string,
  parentUuid: string,
): void {
  logger.info("Registering pending approval", `toolUseId=${toolUseId}`);
  pendingToolApprovals.set(toolUseId, { sessionId, command, parentUuid });
}
