/**
 * Mock message data generators for testing Socket.IO integration.
 * Generates messages in raw Claude JSONL format (with nested message property).
 */

import { randomUUID } from "crypto";
import type { SocketSessionData } from "@arc0/types";
import type {
  ClaudeJSONLMessage,
  ContentBlock,
  CustomTitleMessage,
  MockSession,
} from "./types.js";

// =============================================================================
// Session Generators
// =============================================================================

export function createMockSession(
  overrides: Partial<MockSession> = {},
): MockSession {
  return {
    id: randomUUID(),
    provider: "claude",
    name: null,
    cwd: "/home/user/acme-app", // Working directory path
    model: "claude-sonnet-4-20250514",
    gitBranch: "main",
    startedAt: new Date().toISOString(),
    open: true,
    ...overrides,
  };
}

export function sessionToSessionData(session: MockSession): SocketSessionData {
  // Match Base service behavior: name, model, gitBranch are null
  // (these are extracted from JSONL, not session files)
  return {
    id: session.id,
    provider: session.provider,
    cwd: session.cwd ?? "", // Working directory path, mobile generates hash ID
    name: null,
    model: null,
    gitBranch: null,
    startedAt: session.startedAt,
  };
}

// =============================================================================
// Message Generators (raw JSONL format with nested message property)
// =============================================================================

let messageCounter = 0;

// Mock constants matching real Claude JSONL format
const MOCK_VERSION = "2.1.12";
const MOCK_MODEL = "claude-sonnet-4-20250514";
const MOCK_CWD = "/home/user/acme-app";
const MOCK_GIT_BRANCH = "main";
const MOCK_SLUG = "acme-demo-project";

/**
 * Generate a mock message ID matching Claude's format.
 */
function generateMessageId(): string {
  return `msg_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

/**
 * Generate a mock request ID matching Claude's format.
 */
function generateRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
}

function createBaseMessage(
  type: ClaudeJSONLMessage["type"],
  content: ContentBlock[],
  parentUuid?: string,
  stopReason?: string | null,
): ClaudeJSONLMessage {
  messageCounter++;
  const isAssistant = type === "assistant";

  return {
    // Required fields
    type,
    uuid: randomUUID(),
    parentUuid: parentUuid ?? null,
    timestamp: new Date().toISOString(),
    message: {
      role: type,
      content,
      // Assistant-only message fields
      ...(isAssistant && {
        model: MOCK_MODEL,
        id: generateMessageId(),
        type: "message" as const,
        usage: {
          input_tokens: 100 + messageCounter * 50,
          output_tokens: 200 + messageCounter * 30,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 1000 + messageCounter * 100,
          service_tier: "standard",
        },
        stop_reason: stopReason ?? "end_turn",
        stop_sequence: null,
      }),
    },
    // Optional fields (matching real JSONL format)
    cwd: MOCK_CWD,
    isSidechain: false,
    userType: "external",
    version: MOCK_VERSION,
    gitBranch: MOCK_GIT_BRANCH,
    slug: MOCK_SLUG,
    // Assistant-only top-level fields
    ...(isAssistant && {
      requestId: generateRequestId(),
    }),
  };
}

// User Messages
// Note: sessionId is not part of the JSONL payload - it's in the envelope wrapper
export function createUserTextMessage(
  _sessionId: string,
  text: string,
): ClaudeJSONLMessage {
  return createBaseMessage("user", [{ type: "text", text }]);
}

// Assistant Messages
export function createAssistantTextMessage(
  _sessionId: string,
  text: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage("assistant", [{ type: "text", text }], parentUuid);
}

// Mock signature for thinking blocks (matches real Claude format)
const MOCK_THINKING_SIGNATURE = "EvAECkYIChgCKkCMOCKSIGNATURE==";

export function createAssistantWithThinking(
  _sessionId: string,
  thinking: string,
  text: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      { type: "thinking", thinking, signature: MOCK_THINKING_SIGNATURE },
      { type: "text", text },
    ],
    parentUuid,
  );
}

export function createThinkingOnlyMessage(
  _sessionId: string,
  thinking: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [{ type: "thinking", thinking, signature: MOCK_THINKING_SIGNATURE }],
    parentUuid,
    null, // stop_reason is null for thinking-only (streaming)
  );
}

// Tool Use Messages
export function createToolUseRead(
  _sessionId: string,
  filePath: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "Read",
        input: { file_path: filePath },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

export function createToolUseGrep(
  _sessionId: string,
  pattern: string,
  path?: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "Grep",
        input: { pattern, path: path ?? "." },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

export function createToolUseWrite(
  _sessionId: string,
  filePath: string,
  content: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "Write",
        input: { file_path: filePath, content },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

export function createToolUseBash(
  _sessionId: string,
  command: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "Bash",
        input: { command },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

/**
 * Create a Bash tool_use with description (for testing tool permission approval).
 * This creates a pending tool that requires user approval in the mobile app.
 */
export function createToolUsePermission(
  _sessionId: string,
  command: string,
  description: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "Bash",
        input: { command, description },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

export function createToolResult(
  _sessionId: string,
  toolUseId: string,
  result: string,
  isError = false,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "user",
    [
      {
        type: "tool_result",
        tool_use_id: toolUseId,
        content: result,
        is_error: isError,
      },
    ],
    parentUuid,
  );
}

// =============================================================================
// AskUserQuestion Variants
// =============================================================================

/**
 * Question option type matching Claude's AskUserQuestion format.
 */
interface QuestionOption {
  label: string;
  description: string;
}

/**
 * Question type matching Claude's AskUserQuestion format.
 */
interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

/**
 * Create a simple AskUserQuestion with a single question and options.
 */
export function createAskUserQuestion(
  _sessionId: string,
  question: string,
  options: string[],
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question,
              header: "Choice",
              options: options.map((label) => ({ label, description: "" })),
              multiSelect: false,
            },
          ],
        },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

/**
 * Create an AskUserQuestion with a single multi-select question.
 * User can select multiple options.
 */
export function createAskUserQuestionMultiSelect(
  _sessionId: string,
  question: string,
  header: string,
  options: QuestionOption[],
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question,
              header,
              options,
              multiSelect: true,
            },
          ],
        },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

/**
 * Create an AskUserQuestion with multiple questions.
 * Each question can be single-select or multi-select.
 */
export function createAskUserQuestionMulti(
  _sessionId: string,
  questions: Question[],
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "AskUserQuestion",
        input: { questions },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

/**
 * Create a realistic AskUserQuestion for a "next steps" decision.
 * Based on real Claude JSONL format.
 */
export function createAskUserQuestionNextSteps(
  _sessionId: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createAskUserQuestionMulti(
    _sessionId,
    [
      {
        question: "Would you like me to create a plan to fix these issues?",
        header: "Next steps",
        options: [
          {
            label: "Fix critical + important issues",
            description:
              "Create a plan to fix the 5 highest priority bugs identified",
          },
          {
            label: "Fix all issues",
            description: "Create a comprehensive plan addressing all findings",
          },
          {
            label: "No fixes needed",
            description: "This was just for information",
          },
        ],
        multiSelect: false,
      },
    ],
    parentUuid,
  );
}

/**
 * Create a realistic multi-question AskUserQuestion for feature configuration.
 * Tests multiple questions with different select modes.
 */
export function createAskUserQuestionFeatureConfig(
  _sessionId: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createAskUserQuestionMulti(
    _sessionId,
    [
      {
        question: "Which authentication method should we use?",
        header: "Auth method",
        options: [
          {
            label: "JWT tokens",
            description: "Stateless authentication with signed tokens",
          },
          {
            label: "Session cookies",
            description: "Traditional server-side session management",
          },
          {
            label: "OAuth 2.0",
            description: "Third-party authentication providers",
          },
        ],
        multiSelect: false,
      },
      {
        question: "Which features do you want to enable?",
        header: "Features",
        options: [
          {
            label: "Email verification",
            description: "Require users to verify their email address",
          },
          {
            label: "Two-factor auth",
            description: "Optional 2FA with TOTP or SMS",
          },
          {
            label: "Social login",
            description: "Sign in with Google, GitHub, etc.",
          },
          {
            label: "Rate limiting",
            description: "Protect against brute force attacks",
          },
        ],
        multiSelect: true,
      },
    ],
    parentUuid,
  );
}

/**
 * Create a realistic multi-select AskUserQuestion for selecting components.
 */
export function createAskUserQuestionSelectComponents(
  _sessionId: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createAskUserQuestionMultiSelect(
    _sessionId,
    "Which UI components should I create for this feature?",
    "Components",
    [
      { label: "Form component", description: "Input form with validation" },
      { label: "List view", description: "Display items in a scrollable list" },
      {
        label: "Detail modal",
        description: "Show item details in a modal dialog",
      },
      { label: "Filter bar", description: "Filter and search controls" },
    ],
    parentUuid,
  );
}

export function createExitPlanMode(
  _sessionId: string,
  planContent?: string,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "ExitPlanMode",
        input: {
          allowedPrompts: [],
          ...(planContent ? { plan: planContent } : {}),
        },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

export function createTodoWrite(
  _sessionId: string,
  todos: Array<{ content: string; status: string; activeForm: string }>,
  parentUuid?: string,
): ClaudeJSONLMessage {
  return createBaseMessage(
    "assistant",
    [
      {
        type: "tool_use",
        id: `toolu_${randomUUID().slice(0, 8)}`,
        name: "TodoWrite",
        input: { todos },
      },
    ],
    parentUuid,
    "tool_use",
  );
}

/**
 * Create a TodoWrite message with auto-generated tasks.
 * Tasks are named "Task 1", "Task 2", etc.
 * First task is in_progress, rest are pending.
 */
export function createTodoWriteWithCount(
  _sessionId: string,
  count: number,
  parentUuid?: string,
): ClaudeJSONLMessage {
  const todos = Array.from({ length: count }, (_, i) => ({
    content: `Task ${i + 1}`,
    status: i === 0 ? "in_progress" : "pending",
    activeForm: `Working on Task ${i + 1}`,
  }));
  return createTodoWrite(_sessionId, todos, parentUuid);
}

// =============================================================================
// Metadata Messages (non-conversation messages)
// =============================================================================

/**
 * Create a custom-title message for renaming a session.
 * This matches the raw JSONL format from Claude Code.
 */
export function createCustomTitleMessage(
  sessionId: string,
  customTitle: string,
): CustomTitleMessage {
  return {
    type: "custom-title",
    customTitle,
    sessionId,
  };
}

// =============================================================================
// Sample Conversation
// =============================================================================

export function createSampleConversation(
  sessionId: string,
): ClaudeJSONLMessage[] {
  const messages: ClaudeJSONLMessage[] = [];

  // User asks a question
  const userMsg = createUserTextMessage(
    sessionId,
    "How do I implement the checkout flow?",
  );
  messages.push(userMsg);

  // Assistant responds with thinking
  const assistantMsg = createAssistantWithThinking(
    sessionId,
    "The user wants to implement a checkout flow. I should explain how to create a product card component that handles cart interactions.",
    `To implement the checkout flow, start with a ProductCard component:

\`\`\`tsx
function ProductCard({ product }: { product: Product }) {
  const [quantity, setQuantity] = useState(1);

  return (
    <div>
      <h2>{product.name}</h2>
      <button onClick={() => addToCart(product, quantity)}>
        Add to Cart
      </button>
    </div>
  );
}
\`\`\`

This component displays product info and handles adding items to the cart.`,
    userMsg.uuid,
  );
  messages.push(assistantMsg);

  return messages;
}
