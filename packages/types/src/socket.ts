/**
 * Socket.IO event types for Base <-> App communication.
 */

import type { ProviderId } from "./enums";
import type { ContentBlock } from "./content-blocks";
import type { SessionEvent } from "./session";
import type {
  ActionResult,
  ApproveToolUsePayload,
  OpenSessionPayload,
  SendPromptPayload,
  StopAgentPayload,
} from "./user-actions";

// =============================================================================
// Encryption Types
// =============================================================================

// Import type for local use; re-export for consumers
import type { EncryptedEnvelope } from "@arc0/crypto";
export type { EncryptedEnvelope };

// =============================================================================
// Socket.IO Authentication
// =============================================================================

/**
 * Socket.IO handshake auth using per-client token.
 */
export interface SocketAuth {
  /** Unique device identifier */
  deviceId: string;
  /** Auth token derived from SPAKE2 pairing */
  authToken: string;
}

// =============================================================================
// Pairing Protocol Types
// =============================================================================

/**
 * Pairing error codes.
 */
export type PairingErrorCode =
  | "INVALID_CODE"
  | "INVALID_FORMAT"
  | "TIMEOUT"
  | "MAC_MISMATCH"
  | "ALREADY_PAIRED"
  | "PAIRING_DISABLED";

/**
 * Client -> Server: Initialize pairing with SPAKE2 message.
 */
export interface PairInitPayload {
  /** Unique device identifier */
  deviceId: string;
  /** Human-readable device name */
  deviceName: string;
  /** SPAKE2 public message (hex encoded) */
  spake2Message: string;
}

/**
 * Server -> Client: SPAKE2 challenge response.
 */
export interface PairChallengePayload {
  /** SPAKE2 public message (hex encoded) */
  spake2Message: string;
}

/**
 * Client -> Server: Confirmation MAC.
 */
export interface PairConfirmPayload {
  /** HMAC confirmation (hex encoded) */
  mac: string;
}

/**
 * Server -> Client: Pairing complete with workstation info.
 */
export interface PairCompletePayload {
  /** Server's HMAC confirmation (hex encoded) */
  mac: string;
  /** Workstation ID to store */
  workstationId: string;
  /** Workstation name for display */
  workstationName: string;
}

/**
 * Server -> Client: Pairing error.
 */
export interface PairErrorPayload {
  code: PairingErrorCode;
  message: string;
}

// =============================================================================
// Transport Types (simplified for socket payloads)
// =============================================================================

/**
 * Session data sent over socket.
 * Simplified version of Session entity for transport.
 */
export interface SocketSessionData {
  id: string;
  provider: ProviderId;
  cwd: string; // Working directory path, mobile generates hash ID for project
  name: string | null;
  model: string | null;
  gitBranch: string | null;
  startedAt: string; // ISO string for transport
  interactive?: boolean; // true if session is running in tmux (can receive input)
}

/**
 * Project data sent over socket.
 * Represents a known project directory from ~/.claude/projects/
 */
export interface SocketProjectData {
  cwd: string; // absolute path (e.g., "/Users/x/myproject")
}

/**
 * Message sent over socket.
 * Simplified version of Message entity for transport.
 */
export interface SocketMessage {
  uuid: string;
  sessionId: string;
  parentUuid?: string;
  type: "user" | "assistant" | "system";
  timestamp: string; // ISO string for transport
  cwd?: string;
  content: ContentBlock[];
  stopReason?: "end_turn" | "tool_use" | null;
  usage?: { inputTokens: number; outputTokens: number };
}

/**
 * Session cursor - tracks last known message position.
 * Used for cursor-based sync to resume from where client left off.
 */
export interface SessionCursor {
  sessionId: string;
  lastMessageTs: string; // Primary cursor - timestamp comparison
  lastMessageId?: string; // Optional - for deduplication if needed
}

// =============================================================================
// Event Payloads
// =============================================================================

/**
 * Payload for init event (App -> Base on connect).
 */
export interface InitPayload {
  deviceId: string;
  cursor: SessionCursor[];
}

/**
 * Payload for sessions event (Base -> App).
 */
export interface SessionsSyncPayload {
  workstationId: string;
  sessions: SocketSessionData[];
}

/**
 * Payload for projects event (Base -> App).
 */
export interface ProjectsSyncPayload {
  workstationId: string;
  projects: SocketProjectData[];
}

/**
 * Payload for messages event (Base -> App).
 */
export interface MessagesBatchPayload {
  workstationId: string;
  messages: SocketMessage[];
  batchId: string;
}

/**
 * Payload for permissionRequest event (Base -> App).
 */
export interface PermissionRequestPayload {
  workstationId: string;
  sessionId: string;
  event: SessionEvent;
}

// =============================================================================
// Socket.IO Event Maps
// =============================================================================

/**
 * Events: Base -> App (pairing events - unauthenticated)
 */
export interface PairingServerToClient {
  "pair:challenge": (payload: PairChallengePayload) => void;
  "pair:complete": (payload: PairCompletePayload) => void;
  "pair:error": (payload: PairErrorPayload) => void;
}

/**
 * Events: App -> Base (pairing events - unauthenticated)
 */
export interface PairingClientToServer {
  "pair:init": (payload: PairInitPayload) => void;
  "pair:confirm": (payload: PairConfirmPayload) => void;
}

/**
 * Events: Base -> App (authenticated, encrypted)
 */
export interface ServerToClient extends PairingServerToClient {
  // Encrypted payloads
  "sessions": (payload: EncryptedEnvelope) => void;
  "projects": (payload: EncryptedEnvelope) => void;
  "messages": (payload: EncryptedEnvelope, ack: () => void) => void;
  // Note: Permission requests are sent through the "messages" channel
  // with payload.type === 'permission_request'
}

/**
 * Events: App -> Base (authenticated, encrypted)
 */
export interface ClientToServer extends PairingClientToServer {
  // init remains unencrypted (cursor sync, no sensitive data)
  init: (payload: InitPayload) => void;
  // User actions - encrypted payloads with ack
  openSession: (payload: EncryptedEnvelope, ack: (result: ActionResult) => void) => void;
  sendPrompt: (payload: EncryptedEnvelope, ack: (result: ActionResult) => void) => void;
  stopAgent: (payload: EncryptedEnvelope, ack: (result: ActionResult) => void) => void;
  approveToolUse: (payload: EncryptedEnvelope, ack: (result: ActionResult) => void) => void;
}

// =============================================================================
// Raw Message Envelope (JSONL passthrough from Base to App)
// =============================================================================

/**
 * Raw JSONL line wrapped with session context.
 * Base sends raw JSONL lines without transformation.
 * App handles parsing, filtering, and transformation.
 */
export interface RawMessageEnvelope {
  sessionId: string;
  payload: unknown; // Raw JSONL line (ClaudeJsonlLine from claude/jsonl.ts)
}

/**
 * Payload for messages event using raw envelopes.
 */
export interface RawMessagesBatchPayload {
  workstationId: string;
  messages: RawMessageEnvelope[];
  batchId: string;
}
