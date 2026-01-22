#!/usr/bin/env node
/**
 * Headless mode for basemock - runs server without TUI.
 * Used by Playwright tests for E2E testing.
 *
 * Usage: tsx headless.ts --port 3863 --secret mysecret
 *
 * This mode exposes:
 * - Socket.IO server on the main port (for mobile app connection)
 * - HTTP control API on port+1 (for test message injection)
 */

import { createServer } from "http";
import {
  startServer,
  stopServer,
  createSession,
  sendSessionsSync,
  sendMessagesBatch,
  registerPendingToolApproval,
  getAllSessions,
  getCurrentSession,
} from "./server.js";
import {
  createToolUseBash,
  createToolUsePermission,
  createAskUserQuestion,
  createExitPlanMode,
  createAssistantTextMessage,
  createUserTextMessage,
} from "./mocks.js";
import type { ClaudeJSONLMessage } from "./types.js";

// =============================================================================
// CLI Argument Parsing
// =============================================================================

function parseArgs(): { port: number; secret?: string } {
  const args = process.argv.slice(2);
  let port = 3863;
  let secret: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--port" && args[i + 1]) {
      port = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === "--secret" && args[i + 1]) {
      secret = args[i + 1];
      i++;
    }
  }

  return { port, secret };
}

// =============================================================================
// HTTP Control API
// =============================================================================

interface InjectMessageRequest {
  sessionId: string;
  type:
    | "bash"
    | "bash-permission"
    | "ask-question"
    | "exit-plan-mode"
    | "assistant-text"
    | "user-text";
  // For bash/bash-permission
  command?: string;
  description?: string;
  // For ask-question
  question?: string;
  options?: string[];
  // For exit-plan-mode
  planContent?: string;
  // For text messages
  text?: string;
  // Common
  parentUuid?: string;
  // Whether to register as pending approval (for tool permission tests)
  registerPending?: boolean;
}

interface InjectMessageResponse {
  success: boolean;
  messageId?: string;
  toolUseId?: string;
  error?: string;
}

function createControlServer(mainPort: number): void {
  const controlPort = mainPort + 1;

  const server = createServer(async (req, res) => {
    // CORS headers for test requests
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url || "/", `http://localhost:${controlPort}`);

    // GET /api/sessions - list all sessions
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      const sessions = getAllSessions();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // GET /api/current-session - get current session
    if (req.method === "GET" && url.pathname === "/api/current-session") {
      const session = getCurrentSession();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ session }));
      return;
    }

    // POST /api/inject-message - inject a message to mobile app
    if (req.method === "POST" && url.pathname === "/api/inject-message") {
      try {
        const body = await readRequestBody(req);
        const request: InjectMessageRequest = JSON.parse(body);

        const result = await handleInjectMessage(request);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ success: false, error: String(err) }));
      }
      return;
    }

    // POST /api/sync-sessions - trigger session sync to connected clients
    if (req.method === "POST" && url.pathname === "/api/sync-sessions") {
      sendSessionsSync();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ success: true }));
      return;
    }

    // 404 for unknown routes
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(controlPort, () => {
    console.log(
      `[basemock] Control API running on http://localhost:${controlPort}`,
    );
  });
}

function readRequestBody(req: import("http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleInjectMessage(
  request: InjectMessageRequest,
): Promise<InjectMessageResponse> {
  const { sessionId, type, parentUuid, registerPending } = request;

  let message: ClaudeJSONLMessage;
  let toolUseId: string | undefined;

  switch (type) {
    case "bash":
      message = createToolUseBash(
        sessionId,
        request.command || 'echo "test"',
        parentUuid,
      );
      toolUseId = (message.message.content[0] as { id?: string }).id;
      break;

    case "bash-permission":
      message = createToolUsePermission(
        sessionId,
        request.command || "npm run build",
        request.description || "Run the build command",
        parentUuid,
      );
      toolUseId = (message.message.content[0] as { id?: string }).id;
      break;

    case "ask-question":
      message = createAskUserQuestion(
        sessionId,
        request.question || "Which option do you prefer?",
        request.options || ["Option A", "Option B", "Option C"],
        parentUuid,
      );
      toolUseId = (message.message.content[0] as { id?: string }).id;
      break;

    case "exit-plan-mode":
      message = createExitPlanMode(sessionId, request.planContent, parentUuid);
      toolUseId = (message.message.content[0] as { id?: string }).id;
      break;

    case "assistant-text":
      message = createAssistantTextMessage(
        sessionId,
        request.text || "Hello from assistant",
        parentUuid,
      );
      break;

    case "user-text":
      message = createUserTextMessage(
        sessionId,
        request.text || "Hello from user",
      );
      break;

    default:
      return { success: false, error: `Unknown message type: ${type}` };
  }

  // Register as pending approval if requested (for tool permission tests)
  if (registerPending && toolUseId) {
    registerPendingToolApproval(
      toolUseId,
      sessionId,
      request.command || "",
      message.uuid,
    );
    console.log(`[basemock] Registered pending approval: ${toolUseId}`);
  }

  // Send the message to all connected mobile clients
  await sendMessagesBatch(sessionId, [message]);
  console.log(
    `[basemock] Injected ${type} message to session ${sessionId.slice(0, 8)}...`,
  );

  return {
    success: true,
    messageId: message.uuid,
    toolUseId,
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

async function main() {
  const { port, secret } = parseArgs();

  console.log(`[basemock] Starting headless server on port ${port}...`);
  if (secret) {
    console.log(`[basemock] Secret configured: ${secret.slice(0, 8)}...`);
  }

  try {
    await startServer({ port, secret });
    console.log(`[basemock] Server running on http://localhost:${port}`);

    // Start the HTTP control API on port+1
    createControlServer(port);

    // Create a default session for testing
    const session = createSession("Sample Session");
    console.log(
      `[basemock] Created default session: ${session.id.slice(0, 8)}...`,
    );
    sendSessionsSync();

    // Keep process alive and handle graceful shutdown
    process.on("SIGTERM", async () => {
      console.log("[basemock] Received SIGTERM, shutting down...");
      await stopServer();
      process.exit(0);
    });

    process.on("SIGINT", async () => {
      console.log("[basemock] Received SIGINT, shutting down...");
      await stopServer();
      process.exit(0);
    });

    // Heartbeat to keep process alive
    setInterval(() => {
      // Keep process alive
    }, 1000);
  } catch (err) {
    console.error("[basemock] Failed to start:", err);
    process.exit(1);
  }
}

main();
