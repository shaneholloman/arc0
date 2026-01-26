import type { SessionStatus } from './session-status';

/**
 * Pending permission request from daemon.
 * Stored in session when Claude Code is waiting for tool approval.
 */
export interface PendingPermission {
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  permissionMode: string;
  timestamp: string;
}

export interface Session {
  id: string;
  name: string | null;
  firstMessage: string | null;
  projectName: string;
  providerId: string;
  model: string | null;
  gitBranch: string | null;
  startedAt: string;
  endedAt: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  status: SessionStatus;
  statusDetail: string;
  /** Pending permission request, if any. Null when no approval is needed. */
  pendingPermission: PendingPermission | null;
}

export interface User {
  id: string;
  name: string;
  email: string;
}

export type ContentBlockType = 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'image';

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
  isEncrypted?: boolean;
  summary?: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock | ImageBlock;

export interface StructuredPatch {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface FileChangeItem {
  id: string;
  path: string;
  operation: 'create' | 'edit' | 'delete';
  diff: string | null;
  timestamp: string;
  staged: boolean;
}

export interface ToolUseResultMetadata {
  filePath?: string;
  stdout?: string;
  stderr?: string;
  interrupted?: boolean;
  isImage?: boolean;
  type?: 'create' | 'update' | 'text';
  content?: string;
  originalFile?: string;
  newString?: string;
  oldString?: string;
  structuredPatch?: StructuredPatch[];
}

export interface Message {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant';
  content: ContentBlock[];
  stopReason?: 'end_turn' | 'tool_use' | null;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  toolUseResult?: ToolUseResultMetadata;
  isInProgress?: boolean;
}

// System message subtypes
export type SystemMessageSubtype =
  | 'api_error'
  | 'compact_boundary'
  | 'local_command'
  | 'stop_hook_summary'
  | 'turn_duration';

// API error cause details
export interface ApiErrorCause {
  code: string;
  path?: string;
  errno?: number;
}

// Compact metadata for context compaction
export interface CompactMetadata {
  trigger: 'auto' | 'manual';
  preTokens: number;
}

// System message (different from user/assistant messages)
// Note: subtype is optional - custom-title and other system messages may not have one
export interface SystemMessage {
  uuid: string;
  parentUuid: string | null;
  sessionId: string;
  timestamp: string;
  type: 'system';
  subtype?: SystemMessageSubtype;
  level?: 'info' | 'warning' | 'error' | 'suggestion';
  content?: string;
  // For api_error
  cause?: ApiErrorCause;
  error?: { cause: ApiErrorCause };
  retryInMs?: number;
  retryAttempt?: number;
  maxRetries?: number;
  // For compact_boundary
  compactMetadata?: CompactMetadata;
  // For stop_hook_summary
  hookCount?: number;
  hookInfos?: Array<{ command: string }>;
  hookErrors?: string[];
  // For turn_duration
  durationMs?: number;
  // For local_command
  commandName?: string;
  commandArgs?: string;
  stdout?: string;
  stderr?: string;
}

// Queue operation for background tasks
export interface QueueOperationMessage {
  type: 'queue-operation';
  operation: 'enqueue' | 'dequeue';
  timestamp: string;
  sessionId: string;
  content: string;
}

// Summary message (for conversation summaries)
export interface SummaryMessage {
  type: 'summary';
  summary: string;
  leafUuid: string;
}

// Union type for all message types that can be rendered
export type RenderableMessage = Message | SystemMessage | QueueOperationMessage;
