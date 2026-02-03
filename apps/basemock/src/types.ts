/**
 * Type definitions for BaseMock server.
 * Imports shared types from @arc0/types, defines basemock-specific types locally.
 */

// =============================================================================
// Import shared types from @arc0/types
// =============================================================================

import type {
  RawMessageEnvelope,
  SocketSessionData,
  SessionsSyncPayload,
  RawMessagesBatchPayload,
  SessionCursor,
  InitPayload,
  ProviderId,
  // User action types
  ActionResult,
  OpenSessionPayload,
  SendPromptPayload,
  StopAgentPayload,
  ApproveToolUsePayload,
} from "@arc0/types";
export type {
  RawMessageEnvelope,
  SocketSessionData,
  SessionsSyncPayload,
  RawMessagesBatchPayload as MessagesBatchPayload,
  SessionCursor,
  InitPayload,
  // User action types
  ActionResult,
  OpenSessionPayload,
  SendPromptPayload,
  StopAgentPayload,
  ApproveToolUsePayload,
};

// =============================================================================
// Content Block Types (raw JSONL format - NOT normalized)
// Basemock sends raw format, mobile's transformer normalizes it
// =============================================================================

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  signature?: string; // Raw format uses 'signature', transformer maps to 'thinkingSignature'
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string; // Raw format uses 'id', not 'toolCallId'
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string; // Raw format uses 'tool_use_id', not 'toolCallId'
  content: string | Array<{ type: "text"; text: string }>;
  is_error?: boolean; // Raw format uses 'is_error', not 'isError'
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock;

// =============================================================================
// Message Types (raw JSONL format - matches real Claude JSONL structure)
// =============================================================================

export type MessageType = "user" | "assistant";

// =============================================================================
// Metadata Message Types (non-conversation messages in JSONL)
// =============================================================================

/**
 * Custom title message - sent when user renames a session.
 * This is a metadata message, not a conversation message.
 */
export interface CustomTitleMessage {
  type: "custom-title";
  customTitle: string;
  sessionId: string;
}

/**
 * Raw message usage format (snake_case as in Claude JSONL).
 * Matches real Claude API response format.
 */
export interface RawMessageUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  service_tier?: string;
}

/**
 * Raw message content wrapper (nested under 'message' in JSONL).
 * Matches real Claude JSONL format exactly.
 */
export interface RawMessageContent {
  role: "user" | "assistant";
  content: ContentBlock[] | string;
  // Assistant-only fields
  model?: string; // e.g., "claude-sonnet-4-20250514"
  id?: string; // e.g., "msg_01ABC..."
  type?: "message"; // Always "message" for assistant
  usage?: RawMessageUsage;
  stop_reason?: string | null;
  stop_sequence?: null;
}

/**
 * Raw JSONL message format - matches what Claude Code writes to .jsonl files.
 * This is the raw format that gets wrapped in RawMessageEnvelope.
 * Mobile's transformer expects this exact structure.
 */
export interface ClaudeJSONLMessage {
  // Required fields
  type: MessageType;
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  message: RawMessageContent;
  // Optional fields (present in real JSONL)
  cwd?: string;
  sessionId?: string;
  isSidechain?: boolean;
  userType?: "external" | "internal";
  version?: string; // e.g., "2.1.7"
  gitBranch?: string | null;
  slug?: string; // e.g., "iridescent-honking-firefly"
  requestId?: string; // e.g., "req_01ABC..." (assistant only)
}

/**
 * Union of all JSONL payload types that can be sent to mobile.
 * Includes both conversation messages and metadata messages.
 */
export type JSONLPayload = ClaudeJSONLMessage | CustomTitleMessage;

// =============================================================================
// Server State (basemock-specific)
// =============================================================================

export interface MockSession {
  id: string;
  provider: ProviderId;
  name: string | null;
  cwd: string | null; // Working directory path, mobile generates hash ID
  model: string;
  gitBranch: string | null;
  startedAt: string;
  open: boolean;
}

export interface ServerState {
  workstationId: string;
  sessions: Map<string, MockSession>;
  currentSessionId: string | null;
}

/**
 * Connected client info tracked by server.
 */
export interface ClientInfo {
  socketId: string;
  deviceId: string | null;
  connectedAt: Date;
  lastAckAt: Date | null;
  cursor: SessionCursor[];
}

// =============================================================================
// UI Types (basemock-specific)
// =============================================================================

export type StatusType = "success" | "error" | "warn" | "info";

export interface StatusMessage {
  text: string;
  type: StatusType;
  timestamp: number;
}

export type CategoryKey = "c" | "s" | "m";

export interface MenuCategory {
  key: CategoryKey;
  label: string;
  items: MenuItem[];
}

export interface MenuItem {
  key: string;
  label: string;
  action: string;
  requiresServer?: boolean;
  requiresSession?: boolean;
}

export interface InputModalConfig {
  title: string;
  placeholder: string;
  initialValue?: string;
  multiline?: boolean;
}

export interface InputModalResult {
  value: string;
  cancelled: boolean;
}
