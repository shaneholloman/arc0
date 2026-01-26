/**
 * Closed session message loading.
 * Loads messages for closed sessions from SQLite on demand.
 */

import type { Indexes, Store } from 'tinybase';
import { executeQuery } from './persister';

// =============================================================================
// Types
// =============================================================================

/**
 * Message row from SQLite query.
 */
interface MessageRow {
  id: string;
  session_id: string;
  parent_id: string | null;
  type: string;
  timestamp: string;
  content: string;
  stop_reason: string | null;
  usage: string | null;
  raw_json: string | null;
}

/**
 * Parse local command from XML content.
 */
function parseLocalCommand(
  content: string
): { commandName: string; commandArgs: string } | null {
  const nameMatch = content.match(/<command-name>([^<]+)<\/command-name>/);
  const argsMatch = content.match(/<command-args>([^<]*)<\/command-args>/);
  if (!nameMatch) return null;
  return {
    commandName: nameMatch[1],
    commandArgs: argsMatch?.[1] || '',
  };
}

/**
 * Parse command output from XML content.
 */
function parseCommandOutput(content: string): { stdout?: string; stderr?: string } | null {
  const stdoutMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  const stderrMatch = content.match(/<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/);
  if (!stdoutMatch && !stderrMatch) return null;
  return {
    stdout: stdoutMatch?.[1],
    stderr: stderrMatch?.[1],
  };
}

/**
 * Strip ANSI escape sequences from text.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Check if raw payload is a meta line that should be skipped.
 */
function isMetaLine(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.isMeta === true;
}

/**
 * Extract text content from raw JSONL payload.
 */
function extractTextContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  const message = p.message as Record<string, unknown> | undefined;
  if (!message?.content) return '';

  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

// =============================================================================
// Load Closed Session Messages
// =============================================================================

/**
 * Load messages for a closed session from SQLite into the TinyBase store.
 * Uses the messagesBySession index for O(1) check if messages are already loaded.
 *
 * @param store - TinyBase store instance
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to load messages for
 * @returns true if messages were loaded, false if already present
 */
export async function loadClosedSessionMessages(
  store: Store,
  indexes: Indexes,
  sessionId: string
): Promise<boolean> {
  // Check if already loaded using index (O(1) lookup instead of O(n) iteration)
  const messageIds = indexes.getSliceRowIds('messagesBySession', sessionId);
  if (messageIds.length > 0) {
    // Already loaded, skip
    return false;
  }

  // Query SQLite for messages (including raw_json for local command detection)
  const messages = await executeQuery<MessageRow>(
    'SELECT id, session_id, parent_id, type, timestamp, content, stop_reason, usage, raw_json FROM messages WHERE session_id = ? ORDER BY timestamp',
    [sessionId]
  );

  if (messages.length === 0) {
    return false;
  }

  // Process messages using two-pass approach with parentUuid matching
  // This ensures outputs are correctly merged with commands even if not immediately adjacent
  type TinyBaseRow = Record<string, string | number>;

  // First pass: build command map, collect outputs, and build ordered message list
  const commandsById = new Map<string, { id: string; row: TinyBaseRow }>();
  const processedMessages: { id: string; row: TinyBaseRow }[] = [];
  const outputMessages: { parentId: string; stdout?: string; stderr?: string }[] = [];

  for (const msg of messages) {
    // Parse raw_json to detect local commands and meta lines
    let rawPayload: unknown = null;
    if (msg.raw_json) {
      try {
        rawPayload = JSON.parse(msg.raw_json);
      } catch {
        // Ignore parse errors
      }
    }

    // Skip meta lines (caveat messages)
    if (rawPayload && isMetaLine(rawPayload)) {
      continue;
    }

    // Extract text content for local command detection
    const textContent = rawPayload ? extractTextContent(rawPayload) : '';

    // Check if this is a local command message
    const commandInfo = parseLocalCommand(textContent);
    if (commandInfo) {
      const row: TinyBaseRow = {
        session_id: msg.session_id,
        parent_id: msg.parent_id ?? '',
        type: 'system',
        subtype: 'local_command',
        timestamp: msg.timestamp,
        content: '[]',
        stop_reason: '',
        usage: '{}',
        command_name: commandInfo.commandName,
        command_args: commandInfo.commandArgs,
      };
      const entry = { id: msg.id, row };
      commandsById.set(msg.id, entry);
      processedMessages.push(entry); // Add in order
      continue;
    }

    // Check if this is a command output message
    const outputInfo = parseCommandOutput(textContent);
    if (outputInfo) {
      const parentId = msg.parent_id ?? '';
      outputMessages.push({
        parentId,
        stdout: outputInfo.stdout ? stripAnsi(outputInfo.stdout) : undefined,
        stderr: outputInfo.stderr ? stripAnsi(outputInfo.stderr) : undefined,
      });
      // Don't add outputs to processedMessages - they're merged into commands
      continue;
    }

    // Regular message - add in order
    processedMessages.push({
      id: msg.id,
      row: {
        session_id: msg.session_id,
        parent_id: msg.parent_id ?? '',
        type: msg.type,
        timestamp: msg.timestamp,
        content: msg.content,
        stop_reason: msg.stop_reason ?? '',
        usage: msg.usage ?? '{}',
      },
    });
  }

  // Second pass: merge outputs into their parent commands using parentId
  // Uses append logic to handle multiple outputs for the same command
  for (const output of outputMessages) {
    const parentCommand = commandsById.get(output.parentId);
    if (parentCommand) {
      // Append stdout if exists, otherwise set
      if (output.stdout) {
        const existingStdout = parentCommand.row.stdout as string | undefined;
        if (existingStdout) {
          parentCommand.row.stdout = existingStdout + '\n' + output.stdout;
        } else {
          parentCommand.row.stdout = output.stdout;
        }
      }
      // Append stderr if exists, otherwise set
      if (output.stderr) {
        const existingStderr = parentCommand.row.stderr as string | undefined;
        if (existingStderr) {
          parentCommand.row.stderr = existingStderr + '\n' + output.stderr;
        } else {
          parentCommand.row.stderr = output.stderr;
        }
      }
    } else if (output.parentId) {
      // Log orphaned output for debugging (parent command not found in this session)
      console.log('[closed-sessions] orphaned command output - parent not found', {
        parentId: output.parentId,
        sessionId,
        hasStdout: !!output.stdout,
        hasStderr: !!output.stderr,
      });
    }
  }

  // Insert into TinyBase store for UI reactivity
  // Note: 'id' is NOT included as cell data - it's the row ID (rowIdColumnName: 'id')
  store.transaction(() => {
    for (const { id, row } of processedMessages) {
      store.setRow('messages', id, row);
    }
  });

  console.log('[closed-sessions] Loaded messages for session:', {
    sessionId,
    rawCount: messages.length,
    processedCount: processedMessages.length,
  });

  return true;
}

/**
 * Check if messages for a session are loaded in the store.
 *
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to check
 * @returns true if messages are already loaded
 */
export function areMessagesLoaded(indexes: Indexes, sessionId: string): boolean {
  const messageIds = indexes.getSliceRowIds('messagesBySession', sessionId);
  return messageIds.length > 0;
}

/**
 * Get message count for a session from the store (for already loaded sessions).
 *
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to get count for
 * @returns Number of messages loaded in store for this session
 */
export function getLoadedMessageCount(indexes: Indexes, sessionId: string): number {
  return indexes.getSliceRowIds('messagesBySession', sessionId).length;
}

// =============================================================================
// Memory Management with LRU Eviction
// =============================================================================

/** Maximum number of closed sessions to keep in memory */
const MAX_CLOSED_SESSIONS_IN_MEMORY = 5;

/**
 * Record access to a closed session for LRU tracking.
 * Updates the access order and triggers pruning if needed.
 *
 * @param store - TinyBase store instance
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID that was accessed
 */
export function recordClosedSessionAccess(
  store: Store,
  indexes: Indexes,
  sessionId: string
): void {
  // Verify session exists and is closed before tracking
  const session = store.getRow('sessions', sessionId);
  if (!session || Number(session.open) !== 0) {
    return;
  }

  // Get current access order
  const accessOrderJson = store.getValue('closed_session_access_order') as string;
  let accessOrder: string[] = [];
  try {
    accessOrder = JSON.parse(accessOrderJson || '[]');
  } catch {
    accessOrder = [];
  }

  // Move sessionId to front (most recent)
  const filtered = accessOrder.filter((id) => id !== sessionId);
  const newOrder = [sessionId, ...filtered];

  // Determine if pruning is needed
  const needsPruning = newOrder.length > MAX_CLOSED_SESSIONS_IN_MEMORY;

  // Only write the final order (avoid redundant store mutations)
  const finalOrder = needsPruning
    ? newOrder.slice(0, MAX_CLOSED_SESSIONS_IN_MEMORY)
    : newOrder;
  store.setValue('closed_session_access_order', JSON.stringify(finalOrder));

  // Schedule pruning asynchronously to avoid blocking the render
  if (needsPruning) {
    setTimeout(() => {
      pruneClosedSessionMessages(store, indexes, newOrder, MAX_CLOSED_SESSIONS_IN_MEMORY);
    }, 0);
  }
}

/**
 * Remove a session from the access tracking (e.g., when session is deleted).
 *
 * @param store - TinyBase store instance
 * @param sessionId - Session ID to remove from tracking
 */
export function removeFromAccessTracking(store: Store, sessionId: string): void {
  const accessOrderJson = store.getValue('closed_session_access_order') as string;
  let accessOrder: string[] = [];
  try {
    accessOrder = JSON.parse(accessOrderJson || '[]');
  } catch {
    accessOrder = [];
  }

  const filtered = accessOrder.filter((id) => id !== sessionId);
  if (filtered.length !== accessOrder.length) {
    store.setValue('closed_session_access_order', JSON.stringify(filtered));
  }
}


/**
 * Remove messages for a closed session from the TinyBase store.
 * Use this to free memory when navigating away from closed sessions.
 *
 * NOTE: This is an optimization for memory management.
 * Messages remain in SQLite and can be reloaded on demand.
 *
 * @param store - TinyBase store instance
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to unload messages for
 */
export function unloadSessionMessages(
  store: Store,
  indexes: Indexes,
  sessionId: string
): void {
  const messageIds = indexes.getSliceRowIds('messagesBySession', sessionId);

  if (messageIds.length === 0) {
    return;
  }

  store.transaction(() => {
    for (const messageId of messageIds) {
      store.delRow('messages', messageId);
    }
  });

  console.log('[closed-sessions] Unloaded messages for session:', {
    sessionId,
    messageCount: messageIds.length,
  });
}

/**
 * Unload messages for closed sessions, keeping only the N most recently accessed.
 * Useful for LRU-style memory management.
 *
 * @param store - TinyBase store instance
 * @param indexes - TinyBase indexes instance
 * @param accessOrder - Array of session IDs in access order (most recent first)
 * @param keepCount - Number of sessions to keep loaded
 */
export function pruneClosedSessionMessages(
  store: Store,
  indexes: Indexes,
  accessOrder: string[],
  keepCount: number
): void {
  // Get closed sessions
  const sessionsToKeep = new Set(accessOrder.slice(0, keepCount));

  // Get all sessions that are closed
  const allSessions = store.getTable('sessions');
  const closedSessionIds = Object.keys(allSessions).filter(
    (id) => Number(allSessions[id].open) === 0 && !sessionsToKeep.has(id)
  );

  // Unload messages for old closed sessions
  for (const sessionId of closedSessionIds) {
    unloadSessionMessages(store, indexes, sessionId);
  }
}
