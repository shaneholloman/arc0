// Re-export shared socket types from @arc0/types
export type {
  ProviderId as Provider,
  // Socket event types
  ServerToClient,
  ClientToServer,
  InitPayload,
  SessionsSyncPayload,
  MessagesBatchPayload,
  SocketSessionData as SessionData,
  SocketMessage,
  SessionCursor,
} from "@arc0/types";

// Import for use in local types
import type { ProviderId, SessionCursor } from "@arc0/types";

// ============================================
// Claude Code Hook Payloads (from stdin)
// ============================================

/**
 * Payload sent by Claude Code to SessionStart hook via stdin
 */
export interface ClaudeSessionStartPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: "SessionStart";
  source: string;
}

/**
 * Payload sent by Claude Code to SessionEnd hook via stdin
 */
export interface ClaudeSessionEndPayload {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: "SessionEnd";
  reason: string;
}

export type ClaudeHookPayload =
  | ClaudeSessionStartPayload
  | ClaudeSessionEndPayload;

// ============================================
// Session File (written by hooks to ~/.arc0/sessions/)
// ============================================

/**
 * Session file written by hooks to track active sessions.
 * Path: ~/.arc0/sessions/{session_id}.json
 */
export interface SessionFile {
  sessionId: string;
  provider: ProviderId;
  cwd: string;
  transcriptPath: string;
  pid: number;
  tty: string | null;
  startedAt: string; // ISO timestamp
  payload: unknown; // raw payload for debugging
}

// ============================================
// Server Types (base-specific)
// ============================================

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

// ============================================
// Daemon Status
// ============================================

export interface DaemonStatus {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
  connectedClients?: number;
  activeWatchers?: ProviderId[];
}
