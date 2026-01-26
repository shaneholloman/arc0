/**
 * Message processor for Socket.IO payloads.
 * Transforms incoming JSONL messages to TinyBase row format.
 */

import type { ClaudeJSONLMessage, SessionData } from './types';

// =============================================================================
// Types for processed data (ready for TinyBase/SQLite)
// =============================================================================

/**
 * Processed message row ready for TinyBase store and SQLite.
 * Note: content and usage are JSON strings, not objects.
 */
export interface ProcessedMessage {
  id: string;
  session_id: string;
  parent_id: string;
  type: 'user' | 'assistant' | 'system';
  timestamp: string;
  content: string; // JSON string of ContentBlock[]
  stop_reason: string;
  usage: string; // JSON string of {inputTokens, outputTokens}
  raw_json: string; // Full original message as JSON string
  // For system messages with subtype 'local_command'
  subtype?: 'local_command';
  command_name?: string;
  command_args?: string;
  stdout?: string;
  stderr?: string;
}

/**
 * Processed session row ready for TinyBase store.
 * Note: 'id' is NOT included - it's the row ID (rowIdColumnName: 'id').
 */
export interface ProcessedSession {
  name: string;
  project_id: string;
  model: string;
  git_branch: string;
  started_at: string;
  open: number;
  workstation_id: string;
  provider: string;
  message_count: number;
  first_message: string;
  last_message_at: string;
  ended_at: string;
}

/**
 * Processed project row ready for TinyBase store.
 * Note: 'id' is NOT included - it's the row ID (rowIdColumnName: 'id').
 * Project ID is a hash of the path (working directory path).
 */
export interface ProcessedProject {
  path: string; // Full working directory path
  name: string;
  starred: number;
}

/**
 * Processed workstation row ready for TinyBase store.
 * Note: 'id' is NOT included - it's the row ID (rowIdColumnName: 'id').
 */
export interface ProcessedWorkstation {
  name: string;
}

// =============================================================================
// Message Processing
// =============================================================================

/**
 * Transform a ClaudeJSONLMessage to ProcessedMessage format.
 * Serializes content and usage to JSON strings for storage.
 */
export function processMessage(msg: ClaudeJSONLMessage): ProcessedMessage {
  return {
    id: msg.uuid,
    session_id: msg.sessionId,
    parent_id: msg.parentUuid ?? '',
    type: msg.type,
    timestamp: msg.timestamp,
    content: JSON.stringify(msg.content),
    stop_reason: msg.stopReason ?? '',
    usage: JSON.stringify(msg.usage ?? {}),
    raw_json: JSON.stringify(msg),
  };
}

/**
 * Process a batch of messages.
 */
export function processMessages(messages: ClaudeJSONLMessage[]): ProcessedMessage[] {
  return messages.map(processMessage);
}

// =============================================================================
// Session Processing
// =============================================================================

/**
 * Transform SessionData from Socket.IO to ProcessedSession format.
 * Sets default values for fields not provided in the payload.
 *
 * @param projectId - Hash ID of the project (generated from projectPath by caller)
 */
export function processSession(session: SessionData, workstationId: string, projectId?: string): ProcessedSession {
  // Note: 'id' is NOT returned - it's the row ID (rowIdColumnName: 'id')
  return {
    name: session.name ?? '',
    project_id: projectId ?? '',
    model: session.model ?? '',
    git_branch: session.gitBranch ?? '',
    started_at: session.startedAt,
    open: 1, // sessions only sends open sessions
    workstation_id: workstationId,
    provider: 'claude',
    message_count: 0, // Will be updated when messages arrive
    first_message: '', // Will be updated when messages arrive
    last_message_at: '',
    ended_at: '',
  };
}

/**
 * Process a batch of sessions.
 *
 * @param projectIdMap - Map of cwd -> projectId (hash)
 */
export function processSessions(
  sessions: SessionData[],
  workstationId: string,
  projectIdMap?: Map<string, string>
): ProcessedSession[] {
  return sessions.map((s) => {
    const projectId = s.cwd ? projectIdMap?.get(s.cwd) : undefined;
    return processSession(s, workstationId, projectId);
  });
}

// =============================================================================
// Project Extraction
// =============================================================================

/**
 * Extract project data from a message.
 * Returns null if message has no cwd.
 * Note: Caller is responsible for generating project ID from path.
 */
export function extractProject(msg: ClaudeJSONLMessage): { path: string; data: ProcessedProject } | null {
  if (!msg.cwd) return null;

  // Extract folder name as display name
  const projectName = msg.cwd.split('/').pop() ?? msg.cwd;

  // Return path separately - caller generates hash ID
  return {
    path: msg.cwd,
    data: {
      path: msg.cwd,
      name: projectName,
      starred: 0,
    },
  };
}

/**
 * Extract unique projects from a batch of messages.
 * Returns a Map keyed by path, with ProcessedProject data as values.
 * Caller is responsible for generating hash IDs from the path keys.
 */
export function extractProjects(messages: ClaudeJSONLMessage[]): Map<string, ProcessedProject> {
  const projects = new Map<string, ProcessedProject>();

  for (const msg of messages) {
    const result = extractProject(msg);
    if (result && !projects.has(result.path)) {
      projects.set(result.path, result.data);
    }
  }

  return projects;
}

// =============================================================================
// Workstation Processing
// =============================================================================

/**
 * Create a ProcessedWorkstation from an ID.
 * Name defaults to "Workstation" + ID prefix for now.
 */
export function processWorkstation(workstationId: string): ProcessedWorkstation {
  // Note: 'id' is NOT returned - it's the row ID (rowIdColumnName: 'id')
  return {
    name: `Workstation ${workstationId.slice(0, 8)}`,
  };
}

// =============================================================================
// Session Metadata Updates
// =============================================================================

export interface SessionMetadataUpdate {
  message_count: number;
  last_message_at: string;
  first_message?: string;
}

/**
 * Calculate session metadata updates from a batch of messages.
 * Returns updates keyed by session ID.
 */
export function calculateSessionMetadata(
  messages: ClaudeJSONLMessage[],
  existingCounts: Map<string, number>
): Map<string, SessionMetadataUpdate> {
  const updates = new Map<string, SessionMetadataUpdate>();

  // Group messages by session
  const bySession = new Map<string, ClaudeJSONLMessage[]>();
  for (const msg of messages) {
    const existing = bySession.get(msg.sessionId) ?? [];
    existing.push(msg);
    bySession.set(msg.sessionId, existing);
  }

  // Calculate updates for each session
  for (const [sessionId, sessionMessages] of bySession) {
    // Sort messages by timestamp to find first and last
    const sorted = [...sessionMessages].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const existingCount = existingCounts.get(sessionId) ?? 0;
    const newCount = existingCount + sessionMessages.length;

    // Get last message timestamp
    const lastMessage = sorted[sorted.length - 1];
    const lastMessageAt = lastMessage?.timestamp ?? '';

    // Get first user message for session context (only if we don't have one yet)
    let firstMessage: string | undefined;
    if (existingCount === 0) {
      const firstUserMsg = sorted.find((m) => m.type === 'user');
      if (firstUserMsg) {
        // Extract text content from first user message
        const textBlock = firstUserMsg.content.find((b) => b.type === 'text');
        if (textBlock && textBlock.type === 'text') {
          // Truncate to first 200 chars
          firstMessage = textBlock.text.slice(0, 200);
        }
      }
    }

    updates.set(sessionId, {
      message_count: newCount,
      last_message_at: lastMessageAt,
      first_message: firstMessage,
    });
  }

  return updates;
}

/**
 * Extract text content from a message for display purposes.
 * Returns the concatenated text of all text blocks.
 */
export function extractMessageText(msg: ClaudeJSONLMessage): string {
  return msg.content
    .filter((b) => b.type === 'text')
    .map((b) => (b as { type: 'text'; text: string }).text)
    .join('\n');
}
