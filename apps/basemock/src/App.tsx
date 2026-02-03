/**
 * App - Main TUI application with split-pane layout.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, useApp, useInput } from "ink";
import { Menu, MENU_CATEGORIES } from "./components/Menu.js";
import { StatusBar } from "./components/StatusBar.js";
import { ServerStatus } from "./components/ServerStatus.js";
import { LogViewer } from "./components/LogViewer.js";
import {
  InputModal,
  SelectModal,
  ConfirmModal,
  WalkModal,
} from "./components/InputModal.js";
import { logger, type LogEntry } from "./logger.js";
import type {
  CategoryKey,
  StatusType,
  MockSession,
  ClaudeJSONLMessage,
  ToolUseBlock,
  JSONLPayload,
} from "./types.js";
import {
  startServer,
  stopServer,
  isServerRunning,
  getConnectedClients,
  createSession,
  closeSession,
  getCurrentSession,
  setCurrentSession,
  getAllSessions,
  getOpenSessions,
  sendSessionsSync,
  sendMessagesBatch,
  setNextToolApprovalError,
  registerPendingToolApproval,
  type ClientInfo,
} from "./server.js";
import {
  createUserTextMessage,
  createAssistantTextMessage,
  createAssistantWithThinking,
  createThinkingOnlyMessage,
  createSampleConversation,
  createToolUseRead,
  createToolUseGrep,
  createToolUseWrite,
  createToolUseBash,
  createToolResult,
  createAskUserQuestion,
  createAskUserQuestionMultiSelect,
  createAskUserQuestionFeatureConfig,
  createAskUserQuestionNextSteps,
  createExitPlanMode,
  createTodoWrite,
  createTodoWriteWithCount,
  createCustomTitleMessage,
  createToolUsePermission,
} from "./mocks.js";

const PORT = 3863;
const LOG_MAX_VISIBLE = 20;

function isToolUseBlock(block: unknown): block is ToolUseBlock {
  return (
    !!block &&
    typeof block === "object" &&
    (block as ToolUseBlock).type === "tool_use" &&
    typeof (block as ToolUseBlock).id === "string"
  );
}

function extractToolUseId(message: ClaudeJSONLMessage): string | null {
  const content = message.message.content;
  if (!Array.isArray(content)) return null;
  const toolUseBlock = content.find(isToolUseBlock);
  return toolUseBlock?.id ?? null;
}

type ModalType =
  | {
      type: "input";
      title: string;
      placeholder: string;
      initialValue?: string;
      onSubmit: (value: string) => void;
    }
  | {
      type: "select";
      title: string;
      options: Array<{ value: string; label: string; hint?: string }>;
      onSelect: (value: string) => void;
    }
  | {
      type: "confirm";
      title: string;
      message: string;
      onConfirm: (confirmed: boolean) => void;
    }
  | {
      type: "walk";
      title: string;
      message: string;
      step: number;
      total: number;
      sessionId: string;
    }
  | null;

// All message types for the "walk all types" feature
interface WalkStep {
  name: string;
  create: (sessionId: string) => JSONLPayload | JSONLPayload[];
}

const WALK_STEPS: WalkStep[] = [
  {
    name: "User text",
    create: (sid) =>
      createUserTextMessage(sid, "How do I add a product to the cart?"),
  },
  {
    name: "Assistant text",
    create: (sid) =>
      createAssistantTextMessage(
        sid,
        "I can help you add products to the cart.",
      ),
  },
  {
    name: "Assistant + thinking",
    create: (sid) =>
      createAssistantWithThinking(
        sid,
        "The user wants to add products to their cart. I should explain the cart API...",
        "Here is how to add products to the cart.",
      ),
  },
  {
    name: "Thinking only",
    create: (sid) =>
      createThinkingOnlyMessage(
        sid,
        "Analyzing the checkout flow... considering options...",
      ),
  },
  {
    name: "Read tool (auto)",
    create: (sid) => createToolUseRead(sid, "/home/user/acme-app/src/index.ts"),
  },
  {
    name: "Grep tool (auto)",
    create: (sid) => createToolUseGrep(sid, "TODO|FIXME"),
  },
  {
    name: "Write tool (approval)",
    create: (sid) =>
      createToolUseWrite(
        sid,
        "/home/user/acme-app/src/new-file.ts",
        'export const hello = "world";',
      ),
  },
  {
    name: "Bash tool (approval)",
    create: (sid) => createToolUseBash(sid, "npm run build"),
  },
  {
    name: "Tool result (success)",
    create: (sid) =>
      createToolResult(sid, "toolu_walk_test", "Command executed successfully"),
  },
  {
    name: "Tool result (error)",
    create: (sid) =>
      createToolResult(sid, "toolu_walk_err", "Error: File not found", true),
  },
  {
    name: "AskUser (simple)",
    create: (sid) =>
      createAskUserQuestion(sid, "Which database?", [
        "PostgreSQL",
        "SQLite",
        "MongoDB",
      ]),
  },
  {
    name: "AskUser (multi-select)",
    create: (sid) =>
      createAskUserQuestionMultiSelect(sid, "Which features?", "Features", [
        { label: "Auth", description: "User authentication" },
        { label: "API", description: "REST API endpoints" },
        { label: "Tests", description: "Unit tests" },
      ]),
  },
  {
    name: "AskUser (multi-question)",
    create: (sid) => createAskUserQuestionFeatureConfig(sid),
  },
  {
    name: "ExitPlanMode",
    create: (sid) =>
      createExitPlanMode(
        sid,
        "Step 1: Set up\nStep 2: Implement\nStep 3: Test",
      ),
  },
  {
    name: "TodoWrite",
    create: (sid) =>
      createTodoWrite(sid, [
        {
          content: "First task",
          status: "completed",
          activeForm: "Completing first task",
        },
        {
          content: "Second task",
          status: "in_progress",
          activeForm: "Working on second task",
        },
        {
          content: "Third task",
          status: "pending",
          activeForm: "Third task pending",
        },
      ]),
  },
  {
    name: "Custom title (rename)",
    create: (sid) => createCustomTitleMessage(sid, "Demo Session"),
  },
  {
    name: "Tool permission (Bash)",
    create: (sid) => createToolUsePermission(sid, "npm test", "Run tests"),
  },
];

export function App(): React.ReactElement {
  const { exit } = useApp();

  // Server state
  const [serverRunning, setServerRunning] = useState(isServerRunning());
  const [clients, setClients] = useState<ClientInfo[]>(getConnectedClients());
  const [currentSession, setCurrentSessionState] = useState<MockSession | null>(
    getCurrentSession(),
  );

  // UI state
  const [activeCategory, setActiveCategory] = useState<CategoryKey | null>(
    null,
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusType, setStatusType] = useState<StatusType>("info");
  const [logs, setLogs] = useState<LogEntry[]>(logger.getAll());
  const [modal, setModal] = useState<ModalType>(null);
  const [logScrollOffset, setLogScrollOffset] = useState(0);
  const lastLogCount = useRef(logs.length);
  const logMaxOffset = Math.max(0, logs.length - LOG_MAX_VISIBLE);

  // Subscribe to log updates
  useEffect(() => {
    const unsubscribe = logger.subscribe((entry) => {
      setLogs((prev) => [...prev, entry]);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const delta = logs.length - lastLogCount.current;
    if (delta > 0 && logScrollOffset > 0) {
      setLogScrollOffset((prev) => Math.min(prev + delta, logMaxOffset));
    } else if (logScrollOffset > logMaxOffset) {
      setLogScrollOffset(logMaxOffset);
    }
    lastLogCount.current = logs.length;
  }, [logs.length, logMaxOffset, logScrollOffset]);

  // Auto-start server and create session on mount
  useEffect(() => {
    startServer({ port: PORT })
      .then(() => {
        logger.success("Server started", `Port ${PORT}`);
        setServerRunning(true);
        // Auto-create a session
        const session = createSession("demo");
        logger.success("Session created", session.id.slice(0, 8));
        sendSessionsSync();
        setCurrentSessionState(session);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : "Unknown error";
        logger.error("Failed to start server", msg);
      });
  }, []);

  // Poll server state periodically
  useEffect(() => {
    const interval = setInterval(() => {
      setServerRunning(isServerRunning());
      setClients(getConnectedClients());
      setCurrentSessionState(getCurrentSession());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  // Auto-clear status message after 5 seconds
  useEffect(() => {
    if (statusMessage) {
      const timeout = setTimeout(() => {
        setStatusMessage(null);
      }, 5000);
      return () => clearTimeout(timeout);
    }
  }, [statusMessage]);

  const setStatus = useCallback((message: string, type: StatusType) => {
    setStatusMessage(message);
    setStatusType(type);
  }, []);

  const closeModal = useCallback(() => {
    setModal(null);
  }, []);

  // Action handlers
  const handleAction = useCallback(
    async (action: string) => {
      switch (action) {
        case "start-server": {
          if (serverRunning) {
            setStatus("Server already running", "warn");
            return;
          }
          try {
            await startServer({ port: PORT });
            logger.success("Server started", `Port ${PORT}`);
            setStatus("Server started", "success");
            setServerRunning(true);
          } catch (err) {
            const msg = err instanceof Error ? err.message : "Unknown error";
            logger.error("Failed to start server", msg);
            setStatus(`Failed: ${msg}`, "error");
          }
          break;
        }

        case "stop-server": {
          if (!serverRunning) {
            setStatus("Server not running", "warn");
            return;
          }
          await stopServer();
          logger.success("Server stopped");
          setStatus("Server stopped", "success");
          setServerRunning(false);
          break;
        }

        case "create-session": {
          if (!serverRunning) {
            setStatus("Server not running", "error");
            return;
          }
          setModal({
            type: "input",
            title: "Create Session",
            placeholder: "Session name (optional)",
            onSubmit: (name) => {
              const session = createSession(name || undefined);
              logger.success("Session created", session.id.slice(0, 8));
              sendSessionsSync();
              setStatus("Session created", "success");
              setCurrentSessionState(session);
              closeModal();
            },
          });
          break;
        }

        case "close-session": {
          const sessions = getOpenSessions();
          if (sessions.length === 0) {
            setStatus("No open sessions", "warn");
            return;
          }
          setModal({
            type: "select",
            title: "Close Session",
            options: sessions.map((s) => ({
              value: s.id,
              label: s.name ?? s.id.slice(0, 8),
              hint: s.id.slice(0, 8),
            })),
            onSelect: (sessionId) => {
              closeSession(sessionId);
              sendSessionsSync();
              logger.success("Session closed", sessionId.slice(0, 8));
              setStatus("Session closed", "success");
              setCurrentSessionState(getCurrentSession());
              closeModal();
            },
          });
          break;
        }

        case "select-session": {
          const sessions = getAllSessions();
          if (sessions.length === 0) {
            setStatus("No sessions available", "warn");
            return;
          }
          setModal({
            type: "select",
            title: "Select Active Session",
            options: sessions.map((s) => ({
              value: s.id,
              label: `${s.name ?? s.id.slice(0, 8)} ${s.open ? "" : "(closed)"}`,
              hint: s.id.slice(0, 8),
            })),
            onSelect: (sessionId) => {
              setCurrentSession(sessionId);
              setCurrentSessionState(getCurrentSession());
              logger.info("Active session changed", sessionId.slice(0, 8));
              setStatus("Session selected", "success");
              closeModal();
            },
          });
          break;
        }

        case "sessions-sync": {
          if (!serverRunning) {
            setStatus("Server not running", "error");
            return;
          }
          sendSessionsSync();
          logger.success("Sent sessions");
          setStatus("Sessions sync sent", "success");
          break;
        }

        case "user-text": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "User Message",
            placeholder: "Enter message text",
            onSubmit: async (text) => {
              if (!text) {
                closeModal();
                return;
              }
              const msg = createUserTextMessage(currentSession.id, text);
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("User message sent");
              setStatus("User message sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "assistant-text": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Assistant Message",
            placeholder: "Enter response text",
            onSubmit: async (text) => {
              if (!text) {
                closeModal();
                return;
              }
              const msg = createAssistantTextMessage(currentSession.id, text);
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("Assistant message sent");
              setStatus("Assistant message sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "assistant-thinking": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          // Two-step input: first thinking, then response
          setModal({
            type: "input",
            title: "Thinking Content",
            placeholder: "Enter thinking block",
            onSubmit: (thinking) => {
              if (!thinking) {
                closeModal();
                return;
              }
              setModal({
                type: "input",
                title: "Response Text",
                placeholder: "Enter assistant response",
                onSubmit: async (text) => {
                  if (!text) {
                    closeModal();
                    return;
                  }
                  const msg = createAssistantWithThinking(
                    currentSession.id,
                    thinking,
                    text,
                  );
                  await sendMessagesBatch(currentSession.id, [msg]);
                  logger.success("Assistant + thinking sent");
                  setStatus("Message with thinking sent", "success");
                  closeModal();
                },
              });
            },
          });
          break;
        }

        case "thinking-only": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Thinking Only",
            placeholder: "Enter thinking content",
            onSubmit: async (thinking) => {
              if (!thinking) {
                closeModal();
                return;
              }
              const msg = createThinkingOnlyMessage(
                currentSession.id,
                thinking,
              );
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("Thinking message sent");
              setStatus("Thinking message sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "sample-conversation": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const messages = createSampleConversation(currentSession.id);
          await sendMessagesBatch(currentSession.id, messages);
          logger.success(
            "Sample conversation sent",
            `${messages.length} messages`,
          );
          setStatus(`Sent ${messages.length} messages`, "success");
          break;
        }

        case "tool-read": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Read Tool (auto-approved)",
            placeholder: "File path",
            initialValue: "/home/user/acme-app/src/index.ts",
            onSubmit: async (filePath) => {
              if (!filePath) {
                closeModal();
                return;
              }
              const msg = createToolUseRead(currentSession.id, filePath);
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("Read tool_use sent");
              setStatus("Read tool_use sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "tool-grep": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Grep Tool (auto-approved)",
            placeholder: "Search pattern",
            initialValue: "TODO|FIXME",
            onSubmit: async (pattern) => {
              if (!pattern) {
                closeModal();
                return;
              }
              const msg = createToolUseGrep(currentSession.id, pattern);
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("Grep tool_use sent");
              setStatus("Grep tool_use sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "tool-write": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Write Tool (requires approval) - File Path",
            placeholder: "File path",
            initialValue: "/home/user/acme-app/src/new-file.ts",
            onSubmit: (filePath) => {
              if (!filePath) {
                closeModal();
                return;
              }
              setModal({
                type: "input",
                title: "Write Tool (requires approval) - Content",
                placeholder: "File content",
                initialValue:
                  'export function hello() {\n  return "Hello!";\n}',
                onSubmit: async (content) => {
                  if (!content) {
                    closeModal();
                    return;
                  }
                  const msg = createToolUseWrite(
                    currentSession.id,
                    filePath,
                    content,
                  );
                  await sendMessagesBatch(currentSession.id, [msg]);
                  logger.success("Write tool_use sent");
                  setStatus("Write tool_use sent", "success");
                  closeModal();
                },
              });
            },
          });
          break;
        }

        case "tool-bash": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Bash Tool (requires approval)",
            placeholder: "Command",
            initialValue: "npm run build",
            onSubmit: async (command) => {
              if (!command) {
                closeModal();
                return;
              }
              const msg = createToolUseBash(currentSession.id, command);
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("Bash tool_use sent");
              setStatus("Bash tool_use sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "tool-result": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Tool Result - Tool Use ID",
            placeholder: "Tool use ID",
            initialValue: "toolu_12345678",
            onSubmit: (toolUseId) => {
              if (!toolUseId) {
                closeModal();
                return;
              }
              setModal({
                type: "input",
                title: "Tool Result - Content",
                placeholder: "Result content",
                initialValue: "Command executed successfully",
                onSubmit: (result) => {
                  if (!result) {
                    closeModal();
                    return;
                  }
                  setModal({
                    type: "confirm",
                    title: "Tool Result",
                    message: "Is this an error result?",
                    onConfirm: async (isError) => {
                      const msg = createToolResult(
                        currentSession.id,
                        toolUseId,
                        result,
                        isError,
                      );
                      await sendMessagesBatch(currentSession.id, [msg]);
                      logger.success("Tool result sent");
                      setStatus("Tool result sent", "success");
                      closeModal();
                    },
                  });
                },
              });
            },
          });
          break;
        }

        case "ask-user": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "AskUserQuestion - Question",
            placeholder: "Question text",
            initialValue: "Which database should we use?",
            onSubmit: (question) => {
              if (!question) {
                closeModal();
                return;
              }
              setModal({
                type: "input",
                title: "AskUserQuestion - Options",
                placeholder: "Options (comma-separated)",
                initialValue: "PostgreSQL, SQLite, MongoDB",
                onSubmit: async (optionsStr) => {
                  if (!optionsStr) {
                    closeModal();
                    return;
                  }
                  const options = optionsStr.split(",").map((o) => o.trim());
                  const msg = createAskUserQuestion(
                    currentSession.id,
                    question,
                    options,
                  );
                  await sendMessagesBatch(currentSession.id, [msg]);
                  logger.success("AskUserQuestion sent");
                  setStatus("AskUserQuestion sent", "success");
                  closeModal();
                },
              });
            },
          });
          break;
        }

        case "exit-plan": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "ExitPlanMode - Plan Content (optional)",
            placeholder: "Plan content (leave empty for no plan)",
            onSubmit: async (planContent) => {
              const msg = createExitPlanMode(
                currentSession.id,
                planContent || undefined,
              );
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success(
                "ExitPlanMode sent",
                planContent ? "with plan" : "no plan",
              );
              setStatus("ExitPlanMode sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "ask-user-multi-select": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const msg = createAskUserQuestionMultiSelect(
            currentSession.id,
            "Which UI components should I create?",
            "Components",
            [
              {
                label: "Form component",
                description: "Input form with validation",
              },
              {
                label: "List view",
                description: "Display items in a scrollable list",
              },
              {
                label: "Detail modal",
                description: "Show item details in a modal dialog",
              },
              {
                label: "Filter bar",
                description: "Filter and search controls",
              },
            ],
          );
          await sendMessagesBatch(currentSession.id, [msg]);
          logger.success("AskUser (multi-select) sent");
          setStatus("AskUser (multi-select) sent", "success");
          break;
        }

        case "ask-user-multi-question": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const msg = createAskUserQuestionFeatureConfig(currentSession.id);
          await sendMessagesBatch(currentSession.id, [msg]);
          logger.success("AskUser (multi-question) sent", "2 questions");
          setStatus("AskUser (multi-question) sent", "success");
          break;
        }

        case "ask-user-next-steps": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const msg = createAskUserQuestionNextSteps(currentSession.id);
          await sendMessagesBatch(currentSession.id, [msg]);
          logger.success("AskUser (next steps) sent");
          setStatus("AskUser (next steps) sent", "success");
          break;
        }

        case "todo-write": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "TodoWrite - Task Count (optional)",
            placeholder: "Number of tasks (leave empty for default 4)",
            onSubmit: async (countStr) => {
              const count = parseInt(countStr, 10);
              let msg;
              if (!isNaN(count) && count > 0) {
                // Use auto-generated tasks
                msg = createTodoWriteWithCount(currentSession.id, count);
                logger.success(
                  "TodoWrite sent",
                  `${count} auto-generated tasks`,
                );
              } else {
                // Use default sample tasks
                msg = createTodoWrite(currentSession.id, [
                  {
                    content: "Set up Acme app structure",
                    status: "completed",
                    activeForm: "Setting up project",
                  },
                  {
                    content: "Implement product catalog",
                    status: "in_progress",
                    activeForm: "Implementing catalog",
                  },
                  {
                    content: "Write unit tests",
                    status: "pending",
                    activeForm: "Writing tests",
                  },
                  {
                    content: "Deploy to staging",
                    status: "pending",
                    activeForm: "Deploying",
                  },
                ]);
                logger.success("TodoWrite sent", "4 default tasks");
              }
              await sendMessagesBatch(currentSession.id, [msg]);
              setStatus("TodoWrite sent", "success");
              closeModal();
            },
          });
          break;
        }

        case "rename-session": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          setModal({
            type: "input",
            title: "Rename Session",
            placeholder: "New session title",
            initialValue: currentSession.name ?? "",
            onSubmit: async (title) => {
              if (!title) {
                closeModal();
                return;
              }
              const msg = createCustomTitleMessage(currentSession.id, title);
              await sendMessagesBatch(currentSession.id, [msg]);
              logger.success("Session renamed", title);
              setStatus("Session renamed", "success");
              closeModal();
            },
          });
          break;
        }

        case "tool-permission": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          // First ask if approval should return success or error
          setModal({
            type: "confirm",
            title: "Tool Permission Test",
            message: "Should the approval ack return an error?",
            onConfirm: (shouldError) => {
              // Set the error flag on the server
              setNextToolApprovalError(shouldError);

              // Now ask for command
              setModal({
                type: "input",
                title: "Tool Permission - Command",
                placeholder: "Command to execute",
                initialValue: "npm run build",
                onSubmit: (command) => {
                  if (!command) {
                    closeModal();
                    return;
                  }
                  setModal({
                    type: "input",
                    title: "Tool Permission - Description",
                    placeholder: "Command description",
                    initialValue: "Build the project",
                    onSubmit: async (description) => {
                      const msg = createToolUsePermission(
                        currentSession.id,
                        command,
                        description || "Execute command",
                      );

                      // Extract toolUseId and register pending approval
                      const content = msg.message.content;
                      if (Array.isArray(content)) {
                        const toolUseBlock = content.find(
                          (
                            block,
                          ): block is {
                            type: "tool_use";
                            id: string;
                            name: string;
                            input: Record<string, unknown>;
                          } => block.type === "tool_use",
                        );
                        if (toolUseBlock) {
                          registerPendingToolApproval(
                            toolUseBlock.id,
                            currentSession.id,
                            command,
                            msg.uuid,
                          );
                        }
                      }

                      await sendMessagesBatch(currentSession.id, [msg]);
                      logger.success(
                        "Tool permission sent",
                        shouldError ? "(ack will error)" : "(ack will succeed)",
                      );
                      setStatus("Tool permission sent", "success");
                      closeModal();
                    },
                  });
                },
              });
            },
          });
          break;
        }

        case "tool-auto-approved": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const toolUseMsg = createToolUseBash(
            currentSession.id,
            "npm install moment",
          );
          const toolUseId = extractToolUseId(toolUseMsg);
          if (!toolUseId) {
            setStatus("Failed to create tool_use", "error");
            return;
          }
          const toolResultMsg = createToolResult(
            currentSession.id,
            toolUseId,
            "Command executed successfully:\n$ npm install moment\n\nExit code: 0",
            false,
            toolUseMsg.uuid,
          );
          await sendMessagesBatch(currentSession.id, [
            toolUseMsg,
            toolResultMsg,
          ]);
          logger.success("Auto-approved tool sent");
          setStatus("Auto-approved tool sent", "success");
          break;
        }

        case "tool-approve-delayed": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const toolUseMsg = createToolUseBash(
            currentSession.id,
            "npm install lodash",
          );
          const toolUseId = extractToolUseId(toolUseMsg);
          if (!toolUseId) {
            setStatus("Failed to create tool_use", "error");
            return;
          }
          await sendMessagesBatch(currentSession.id, [toolUseMsg]);
          await new Promise((resolve) => setTimeout(resolve, 800));
          const toolResultMsg = createToolResult(
            currentSession.id,
            toolUseId,
            "Command executed successfully:\n$ npm install lodash\n\nExit code: 0",
            false,
            toolUseMsg.uuid,
          );
          await sendMessagesBatch(currentSession.id, [toolResultMsg]);
          logger.success("Delayed approval sent");
          setStatus("Delayed approval sent", "success");
          break;
        }

        case "tool-reject-delayed": {
          if (!serverRunning || !currentSession) {
            setStatus(
              serverRunning ? "No active session" : "Server not running",
              "error",
            );
            return;
          }
          const toolUseMsg = createToolUseBash(
            currentSession.id,
            "npm install left-pad",
          );
          const toolUseId = extractToolUseId(toolUseMsg);
          if (!toolUseId) {
            setStatus("Failed to create tool_use", "error");
            return;
          }
          await sendMessagesBatch(currentSession.id, [toolUseMsg]);
          await new Promise((resolve) => setTimeout(resolve, 800));
          const toolResultMsg = createToolResult(
            currentSession.id,
            toolUseId,
            "Tool execution was rejected by user",
            true,
            toolUseMsg.uuid,
          );
          await sendMessagesBatch(currentSession.id, [toolResultMsg]);
          logger.success("Delayed rejection sent");
          setStatus("Delayed rejection sent", "success");
          break;
        }

        case "walk-all-types": {
          if (!serverRunning) {
            setStatus("Server not running", "error");
            return;
          }
          // Create a new session for the walk
          const walkSession = createSession("demo-walk");
          logger.success("Walk session created", walkSession.id.slice(0, 8));
          sendSessionsSync();
          setCurrentSessionState(walkSession);

          // Start the walk with step 0
          const firstStep = WALK_STEPS[0]!;
          setModal({
            type: "walk",
            title: `Walk All Types (1/${WALK_STEPS.length})`,
            message: `Press Enter to send: ${firstStep.name}`,
            step: 0,
            total: WALK_STEPS.length,
            sessionId: walkSession.id,
          });
          break;
        }

        // Note: 'system' message type removed - Claude JSONL only supports 'user' and 'assistant'
      }
    },
    [serverRunning, currentSession, setStatus, closeModal],
  );

  // Keyboard handling
  useInput((input, key) => {
    // Ignore input when modal is open
    if (modal) return;

    if (key.upArrow) {
      setLogScrollOffset((prev) => Math.min(prev + 1, logMaxOffset));
      return;
    }
    if (key.downArrow) {
      setLogScrollOffset((prev) => Math.max(prev - 1, 0));
      return;
    }
    if (key.pageUp) {
      setLogScrollOffset((prev) =>
        Math.min(prev + LOG_MAX_VISIBLE, logMaxOffset),
      );
      return;
    }
    if (key.pageDown) {
      setLogScrollOffset((prev) => Math.max(prev - LOG_MAX_VISIBLE, 0));
      return;
    }

    // Quit (only 'q' when no category is active)
    if (input === "q" && !key.ctrl && !key.meta && !activeCategory) {
      if (serverRunning) {
        stopServer().then(() => exit());
      } else {
        exit();
      }
      return;
    }

    // ESC to cancel category selection
    if (key.escape) {
      setActiveCategory(null);
      return;
    }

    // Category keys
    const categoryKeys: CategoryKey[] = ["c", "s", "m"];
    if (categoryKeys.includes(input as CategoryKey)) {
      setActiveCategory(input as CategoryKey);
      return;
    }

    // Action keys when category is active (0-9, a-z)
    if (activeCategory) {
      const category = MENU_CATEGORIES.find((c) => c.key === activeCategory);
      const item = category?.items.find((i) => i.key === input);
      if (item) {
        // Check preconditions
        if (item.requiresServer && !serverRunning) {
          setStatus("Server not running", "error");
          setActiveCategory(null);
          return;
        }
        if (item.requiresSession && !currentSession) {
          setStatus("No active session", "error");
          setActiveCategory(null);
          return;
        }

        // Handle action with proper error catching
        setActiveCategory(null);
        handleAction(item.action).catch((err) => {
          const msg = err instanceof Error ? err.message : "Unknown error";
          logger.error("Action failed", msg);
          setStatus(`Error: ${msg}`, "error");
        });
      }
    }
  });

  return (
    <Box flexDirection="row" width="100%" height="100%">
      {/* Left Pane (40%) */}
      <Box flexDirection="column" width="40%">
        <Menu
          categories={MENU_CATEGORIES}
          activeCategory={activeCategory}
          disabled={modal !== null}
        />
        <StatusBar
          message={statusMessage}
          type={statusType}
          activeCategory={activeCategory}
        />
      </Box>

      {/* Right Pane (60%) */}
      <Box flexDirection="column" width="60%">
        <ServerStatus
          running={serverRunning}
          port={PORT}
          clients={clients}
          currentSession={currentSession}
        />
        <LogViewer
          logs={logs}
          maxVisible={LOG_MAX_VISIBLE}
          scrollOffset={logScrollOffset}
        />
      </Box>

      {/* Modal overlay */}
      {modal?.type === "input" && (
        <Box position="absolute" marginTop={5} marginLeft={5}>
          <InputModal
            title={modal.title}
            placeholder={modal.placeholder}
            initialValue={modal.initialValue}
            onSubmit={modal.onSubmit}
            onCancel={closeModal}
          />
        </Box>
      )}
      {modal?.type === "select" && (
        <Box position="absolute" marginTop={5} marginLeft={5}>
          <SelectModal
            title={modal.title}
            options={modal.options}
            onSelect={modal.onSelect}
            onCancel={closeModal}
          />
        </Box>
      )}
      {modal?.type === "confirm" && (
        <Box position="absolute" marginTop={5} marginLeft={5}>
          <ConfirmModal
            title={modal.title}
            message={modal.message}
            onConfirm={modal.onConfirm}
          />
        </Box>
      )}
      {modal?.type === "walk" && (
        <Box position="absolute" marginTop={5} marginLeft={5}>
          <WalkModal
            title={modal.title}
            message={modal.message}
            step={modal.step}
            total={modal.total}
            onNext={async () => {
              const step = WALK_STEPS[modal.step];
              if (step) {
                const messages = step.create(modal.sessionId);
                const msgArray = Array.isArray(messages)
                  ? messages
                  : [messages];
                await sendMessagesBatch(modal.sessionId, msgArray);
                logger.success(`Sent: ${step.name}`);
              }

              const nextStep = modal.step + 1;
              if (nextStep < WALK_STEPS.length) {
                const nextStepDef = WALK_STEPS[nextStep]!;
                setModal({
                  type: "walk",
                  title: `Walk All Types (${nextStep + 1}/${WALK_STEPS.length})`,
                  message: `Press Enter to send: ${nextStepDef.name}`,
                  step: nextStep,
                  total: WALK_STEPS.length,
                  sessionId: modal.sessionId,
                });
              } else {
                logger.success(
                  "Walk completed",
                  `${WALK_STEPS.length} message types sent`,
                );
                setStatus("Walk completed!", "success");
                closeModal();
              }
            }}
            onCancel={() => {
              logger.info(
                "Walk cancelled",
                `Stopped at step ${modal.step + 1}`,
              );
              setStatus("Walk cancelled", "info");
              closeModal();
            }}
          />
        </Box>
      )}
    </Box>
  );
}
