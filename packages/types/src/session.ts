/**
 * Session event types for the events JSONL file.
 * Path: ~/.arc0/sessions/{sessionId}.events.jsonl
 */

/**
 * Base interface for session events.
 */
interface BaseSessionEvent {
  timestamp: string; // ISO timestamp
}

/**
 * Permission request event - emitted when a tool needs user permission.
 */
export interface PermissionRequestEvent extends BaseSessionEvent {
  type: "permission_request";
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  permissionMode: string;
}

/**
 * Session name change event - emitted when session is renamed (e.g. /rename).
 */
export interface SessionNameChangeEvent extends BaseSessionEvent {
  type: "session_name_change";
  name: string;
}

/**
 * Union of all session event types.
 */
export type SessionEvent = PermissionRequestEvent | SessionNameChangeEvent;
