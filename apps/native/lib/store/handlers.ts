/**
 * Store update handlers for Socket.IO events.
 * Processes incoming data and updates both SQLite (source of truth) and TinyBase (UI reactivity).
 */

import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { Row, Store } from 'tinybase';
import type { ModelId, RawMessageEnvelope, RawMessagesBatchPayload } from '@arc0/types';
import type { SessionData, SessionsSyncPayload } from '../socket/types';
import type { ContentBlock } from '../types/session';
import {
  type ProcessedMessage,
  type ProcessedProject,
  type ProcessedWorkstation,
} from '../socket/processor';
import {
  calculateSessionMetadataFromRaw,
  extractPermissionRequests,
  extractProjectsFromRaw,
  extractResolvedToolUseIds,
  extractSessionGitBranchUpdates,
  extractSessionNameUpdates,
  getLastMessageInfo,
  transformRawBatchWithOutputs,
  type PermissionRequestLine,
  type SessionGitBranchUpdate,
  type SessionNameUpdate,
} from '../socket/transformer';
import {
  extractArtifactsFromRawBatch,
  extractTaskUpdatesFromBatch,
  applyTaskUpdatesToTodos,
  parseTodosContent,
  type ExtractedArtifact,
} from '../socket/artifact-extractor';
import { executeStatement, getDbInstance, withTransaction } from './persister';
import { upsertArtifactToStore, writeArtifactsToSQLite } from './artifacts-loader';
import { computeSessionStatus } from './session-status';

// =============================================================================
// Debug Logging
// =============================================================================

function debugLog(tag: string, message: string, data?: unknown): void {
  if (__DEV__) {
    console.log(`[${tag}] ${message}`, data ?? '');
  }
}

// =============================================================================
// Message Batch Processing Queue
// =============================================================================
// Serializes message batch processing to prevent concurrent SQLite transactions.
// expo-sqlite's withTransactionAsync doesn't support nested transactions, so
// when multiple Socket.IO batches arrive rapidly (e.g., on reconnection), we
// need to process them sequentially.

/**
 * Result from processing a messages batch.
 */
export interface MessagesBatchResult {
  lastMessageId: string;
  lastMessageTs: string;
}

type BatchTask = {
  store: Store;
  payload: RawMessagesBatchPayload;
  resolve: (result: MessagesBatchResult) => void;
  reject: (error: Error) => void;
};

let batchQueue: BatchTask[] = [];
let isProcessingBatch = false;

async function processBatchQueue(): Promise<void> {
  if (isProcessingBatch || batchQueue.length === 0) {
    return;
  }

  isProcessingBatch = true;

  while (batchQueue.length > 0) {
    const task = batchQueue.shift()!;
    try {
      const result = await handleMessagesBatchInternal(task.store, task.payload);
      task.resolve(result);
    } catch (error) {
      task.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  isProcessingBatch = false;
}

// =============================================================================
// Project ID Generation
// =============================================================================

/**
 * Generate a short project ID from workstation + path using SHA256 hash.
 * Includes workstationId to ensure same path on different workstations = different projects.
 * Returns first 16 characters of the hash (64 bits - safe collision resistance).
 */
export async function generateProjectId(workstationId: string, path: string): Promise<string> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${workstationId}:${path}`
  );
  return hash.slice(0, 16);
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Convert a processed object to TinyBase Row type.
 * TinyBase rows need an index signature which our typed interfaces don't provide.
 */
function toRow(obj: ProcessedWorkstation | ProcessedProject | Record<string, unknown>): Row {
  return obj as unknown as Row;
}

// =============================================================================
// Model Parsing (Claude)
// =============================================================================

function parseModelIdFromClaudeModelOutput(stdout: string): ModelId | null {
  const text = stdout.toLowerCase();

  // We only treat explicit "set/kept model" outputs as authoritative.
  if (!text.includes('set model to') && !text.includes('kept model as')) {
    return null;
  }

  if (text.includes('default')) return 'default';
  if (text.includes('opus')) return 'opus-4.5';
  if (text.includes('sonnet')) return 'sonnet-4.5';
  if (text.includes('haiku')) return 'haiku-4.5';

  return null;
}

function updateSessionModelsFromRawBatch(
  store: Store,
  processedMessages: ProcessedMessage[],
  outputMessages: ProcessedMessage[]
): void {
  const updates = new Map<string, ModelId>();

  // 1) Prefer parsing from local command messages so we can scope to `/model` only.
  for (const msg of processedMessages) {
    if (msg.type !== 'system' || msg.subtype !== 'local_command') continue;
    if (msg.command_name !== '/model') continue;
    if (!msg.stdout) continue;
    const model = parseModelIdFromClaudeModelOutput(msg.stdout);
    if (!model) continue;
    updates.set(msg.session_id, model);
  }

  // 2) Also handle late-arriving output-only rows by checking their parent command in TinyBase.
  // This prevents accidental matches from other commands (e.g. `/help` text mentioning "set model to").
  for (const output of outputMessages) {
    if (!output.stdout) continue;
    if (!output.parent_id) continue;

    const parent = store.getRow('messages', output.parent_id) as
      | Record<string, unknown>
      | undefined;
    if (!parent || Object.keys(parent).length === 0) {
      // Parent command isn't in TinyBase (native stores only active session messages).
      // We derive the model when that session's messages are loaded from SQLite.
      continue;
    }
    if (parent.subtype !== 'local_command') continue;
    if (parent.command_name !== '/model') continue;

    const stdout = (parent.stdout as string | undefined) ?? output.stdout;
    const model = parseModelIdFromClaudeModelOutput(stdout);
    if (!model) continue;
    updates.set(output.session_id, model);
  }

  if (updates.size === 0) return;

  store.transaction(() => {
    for (const [sessionId, model] of updates) {
      store.setPartialRow('sessions', sessionId, { model });
    }
  });
}

// =============================================================================
// Session Sync Handler
// =============================================================================

/**
 * Handle sessions event from Base.
 * UPSERTs sessions and marks sessions not in the list as closed.
 *
 * @param store - TinyBase store instance
 * @param payload - Sessions sync payload from Base
 */
export async function handleSessionsSync(
  store: Store,
  payload: SessionsSyncPayload
): Promise<void> {
  const { workstationId, sessions } = payload;
  const sessionIds = new Set(sessions.map((s) => s.id));

  // Verify workstation exists - don't auto-create (would fail NOT NULL url constraint)
  const existingWorkstation = store.getRow('workstations', workstationId);
  if (!existingWorkstation || Object.keys(existingWorkstation).length === 0) {
    console.warn(`[handlers] Ignoring sessions for unknown workstation: ${workstationId}`);
    return;
  }

  // Generate project IDs for all sessions with projectPath (async)
  // Project IDs include workstationId to keep projects separate per workstation
  const projectIdMap = new Map<string, string>(); // path -> hash ID
  for (const session of sessions) {
    if (session.cwd && !projectIdMap.has(session.cwd)) {
      const projectId = await generateProjectId(workstationId, session.cwd);
      projectIdMap.set(session.cwd, projectId);
    }
  }
  let projectsCreated = 0;

  // Process sessions in a transaction
  store.transaction(() => {
    // 1. Upsert projects from sessions (create if not exists)
    for (const session of sessions) {
      if (session.cwd) {
        const projectId = projectIdMap.get(session.cwd);
        if (!projectId) {
          console.error('[handlers] Missing project ID for path:', session.cwd);
          continue;
        }
        const existingProject = store.getRow('projects', projectId);
        if (!existingProject || Object.keys(existingProject).length === 0) {
          // Extract folder name from path for display
          const projectName = session.cwd.split('/').pop() ?? session.cwd;
          store.setRow(
            'projects',
            projectId,
            toRow({
              workstation_id: workstationId,
              path: session.cwd,
              name: projectName,
              starred: 0,
            })
          );
          projectsCreated++;
        }
      }
    }

    // 2. Upsert sessions from payload
    for (const session of sessions) {
      const projectId = session.cwd ? projectIdMap.get(session.cwd) : undefined;
      upsertSession(store, session, workstationId, projectId);
    }

    // 3. Close sessions no longer in list (same workstation only)
    const allSessions = store.getTable('sessions');
    for (const [id, session] of Object.entries(allSessions)) {
      if (
        session.workstation_id === workstationId &&
        Number(session.open) === 1 &&
        !sessionIds.has(id)
      ) {
        store.setPartialRow('sessions', id, {
          open: 0,
          ended_at: new Date().toISOString(),
          status: 'ended',
          status_detail: 'Ended',
        });
      }
    }
  });

  const deviceId = store.getValue('device') as string | undefined;
  console.log('[handlers] sessions processed:', {
    deviceId: deviceId ?? 'unknown',
    workstationId,
    upserted: sessions.length,
    projectsReferenced: projectIdMap.size,
    projectsCreated,
    closed: countClosedSessions(store, workstationId, sessionIds),
  });
}

/**
 * Upsert a single session into the store.
 * Preserves existing metadata (first_message, message_count, name) on update.
 * Note: name is NOT updated from sessions event - it only comes from custom-title messages.
 *
 * @param projectId - Hash ID of the project (generated from projectPath)
 */
function upsertSession(
  store: Store,
  session: SessionData,
  workstationId: string,
  projectId?: string
): void {
  const existing = store.getRow('sessions', session.id);
  const interactive = session.interactive === false ? 0 : 1;

  if (existing && Object.keys(existing).length > 0) {
    // Update existing - preserves name, first_message, message_count, etc.
    // Note: name intentionally excluded - only set via custom-title messages
    const partial: Record<string, string | number> = {
      project_id: projectId ?? '',
      started_at: session.startedAt,
      open: 1,
      interactive,
      workstation_id: workstationId,
    };

    // Preserve existing model if base doesn't provide one (currently TODO in base)
    if (session.model) {
      partial.model = session.model;
    }

    // Preserve existing git_branch - primarily set from JSONL message lines
    if (session.gitBranch) {
      partial.git_branch = session.gitBranch;
    }

    store.setPartialRow('sessions', session.id, partial);
  } else {
    // New session - create with defaults
    // Note: 'id' is NOT included as cell data - it's the row ID (rowIdColumnName: 'id')
    store.setRow('sessions', session.id, {
      name: '', // Empty until custom-title message received
      project_id: projectId ?? '',
      model: session.model ?? '',
      git_branch: session.gitBranch ?? '',
      started_at: session.startedAt,
      open: 1,
      interactive,
      workstation_id: workstationId,
      provider: 'claude',
      message_count: 0,
      first_message: '',
      last_message_at: '',
      ended_at: '',
      status: 'idle',
      status_detail: 'Ready',
    });
  }
}

/**
 * Count how many sessions will be closed (for logging).
 */
function countClosedSessions(
  store: Store,
  workstationId: string,
  openSessionIds: Set<string>
): number {
  let count = 0;
  const allSessions = store.getTable('sessions');
  for (const [id, session] of Object.entries(allSessions)) {
    if (
      session.workstation_id === workstationId &&
      Number(session.open) === 1 &&
      !openSessionIds.has(id)
    ) {
      count++;
    }
  }
  return count;
}

// =============================================================================
// Messages Batch Handler
// =============================================================================

/**
 * Handle messages event from Base.
 * Writes messages to both SQLite (source of truth) and TinyBase (UI reactivity).
 * Queues the batch for sequential processing to avoid concurrent SQLite transactions.
 *
 * @param store - TinyBase store instance
 * @param payload - Raw messages batch payload from Base
 * @returns Result with last message info for acknowledgment
 */
export async function handleMessagesBatch(
  store: Store,
  payload: RawMessagesBatchPayload
): Promise<MessagesBatchResult> {
  return new Promise((resolve, reject) => {
    batchQueue.push({ store, payload, resolve, reject });
    processBatchQueue();
  });
}

/**
 * Internal handler for message batches. Called by the queue processor.
 */
async function handleMessagesBatchInternal(
  store: Store,
  payload: RawMessagesBatchPayload
): Promise<MessagesBatchResult> {
  const { workstationId, messages: rawEnvelopes, batchId } = payload;

  debugLog('messages', 'received batch', {
    batchId,
    workstationId,
    rawCount: rawEnvelopes.length,
    sessionIds: [...new Set(rawEnvelopes.map((e) => e.sessionId))],
  });

  if (rawEnvelopes.length === 0) {
    return { lastMessageId: '', lastMessageTs: '' };
  }

  // Transform raw envelopes to processed messages (filters non-message types)
  // Returns:
  // - merged: commands with stdout/stderr already merged (for TinyBase)
  // - outputs: all output messages (for SQLite persistence)
  // - orphanedOutputs: outputs whose parent wasn't in this batch (for late TinyBase merge)
  const {
    merged: processedMessages,
    outputs: outputMessages,
    orphanedOutputs,
  } = transformRawBatchWithOutputs(rawEnvelopes);

  debugLog('messages', 'transformed batch', {
    batchId,
    inputCount: rawEnvelopes.length,
    outputCount: processedMessages.length,
    outputsCount: outputMessages.length,
    orphanedCount: orphanedOutputs.length,
    filtered: rawEnvelopes.length - processedMessages.length - outputMessages.length,
    messageTypes: processedMessages.map((m) => m.type),
  });

  // Pre-extract permission and git branch updates for early-return batches
  const permissionRequests = extractPermissionRequests(rawEnvelopes);
  const resolvedToolUseIds = extractResolvedToolUseIds(rawEnvelopes);
  const hasPermissionUpdates = permissionRequests.size > 0 || resolvedToolUseIds.size > 0;
  const gitBranchUpdates = extractSessionGitBranchUpdates(rawEnvelopes);

  if (processedMessages.length === 0 && outputMessages.length === 0) {
    // All lines were non-message types (summary, file-history-snapshot, progress, etc.)
    if (hasPermissionUpdates) {
      updatePendingPermissions(store, permissionRequests, resolvedToolUseIds);
    }
    applySessionGitBranchUpdates(store, gitBranchUpdates);
    return { lastMessageId: '', lastMessageTs: '' };
  }

  // Verify workstation exists - don't auto-create (would fail NOT NULL url constraint)
  const existingWorkstation = store.getRow('workstations', workstationId);
  if (!existingWorkstation || Object.keys(existingWorkstation).length === 0) {
    if (hasPermissionUpdates) {
      updatePendingPermissions(store, permissionRequests, resolvedToolUseIds);
    }
    console.warn(`[handlers] Ignoring messages for unknown workstation: ${workstationId}`);
    return { lastMessageId: '', lastMessageTs: '' };
  }

  // Extract and upsert projects from raw envelopes
  // extractProjectsFromRaw returns Map<path, ProcessedProject> - we need to generate hash IDs
  // Project IDs include workstationId to keep projects separate per workstation
  const rawProjects = extractProjectsFromRaw(rawEnvelopes);
  const projectIdMap = new Map<string, string>();
  for (const path of rawProjects.keys()) {
    const projectId = await generateProjectId(workstationId, path);
    projectIdMap.set(path, projectId);
  }

  // Get current message counts for sessions
  const existingCounts = getExistingMessageCountsFromRaw(store, rawEnvelopes);

  // Extract artifacts once so we can write to SQLite before any TinyBase mutations
  const artifacts = extractArtifactsFromRawBatch(rawEnvelopes, 'claude');

  // 1. Write to SQLite `messages` TABLE (source of truth) - native only
  // Include both merged messages AND output messages for closed-session reload merging
  const db = getDbInstance();
  if (db) {
    const allMessagesForSQLite = [...processedMessages, ...outputMessages];
    await writeProcessedMessagesToSQLite(allMessagesForSQLite);
    debugLog('messages', 'saved to SQLite', {
      batchId,
      count: allMessagesForSQLite.length,
      mergedCount: processedMessages.length,
      outputsCount: outputMessages.length,
      messageIds: allMessagesForSQLite.map((m) => m.id),
    });
    if (artifacts.length > 0) {
      await writeArtifactsToSQLite(artifacts);
      debugLog('artifacts', 'saved to SQLite', {
        count: artifacts.length,
        artifactIds: artifacts.map((a) => a.id),
      });
    }
  }

  // 2. Upsert projects in TinyBase (after manual SQLite writes to avoid nested transactions)
  let projectsCreated = 0;
  for (const [path, project] of rawProjects) {
    const projectId = projectIdMap.get(path);
    if (!projectId) {
      console.error('[handlers] Missing project ID for path:', path);
      continue;
    }
    const existingProject = store.getRow('projects', projectId);
    if (!existingProject || Object.keys(existingProject).length === 0) {
      store.setRow(
        'projects',
        projectId,
        toRow({
          ...project,
          workstation_id: workstationId,
          path, // Store raw path
        })
      );
      projectsCreated++;
    }
  }

  // 3. Write messages to TinyBase (UI reactivity)
  // Web: Write ALL messages (OPFS persists entire TinyBase store, no SQLite fallback)
  // Native: Write only active session messages (SQLite has all messages, loaded on-demand)
  const activeSessionId = store.getValue('active_session_id') as string | undefined;
  const messagesToWrite =
    Platform.OS === 'web'
      ? processedMessages
      : activeSessionId
        ? processedMessages.filter((m) => m.session_id === activeSessionId)
        : [];
  if (messagesToWrite.length > 0) {
    writeProcessedMessagesToStore(store, messagesToWrite);
  }
  debugLog('messages', 'saved to TinyBase', {
    batchId,
    count: messagesToWrite.length,
    activeSessionId,
    platform: Platform.OS,
  });

  // 3b. Merge late-arriving (orphaned) outputs into existing command rows in TinyBase
  // This handles outputs that arrive in a different batch than their parent command
  // NOTE: We only merge orphanedOutputs, NOT all outputMessages, to avoid duplicating
  // outputs that were already merged in-batch by transformRawBatchWithOutputs
  // Web: Merge all orphaned outputs (no SQLite fallback)
  // Native: Only merge for active session
  const orphanedOutputsToMerge =
    Platform.OS === 'web'
      ? orphanedOutputs
      : activeSessionId
        ? orphanedOutputs.filter((m) => m.session_id === activeSessionId)
        : [];
  if (orphanedOutputsToMerge.length > 0) {
    mergeOutputsIntoExistingCommands(store, orphanedOutputsToMerge);
    debugLog('messages', 'merged orphaned outputs into existing commands', {
      batchId,
      orphanedCount: orphanedOutputsToMerge.length,
      activeSessionId,
      platform: Platform.OS,
    });
  }

  // 4. Update session metadata
  const metadataUpdates = calculateSessionMetadataFromRaw(rawEnvelopes, existingCounts);
  updateSessionMetadata(store, metadataUpdates);

  // 4b. Update session model from Claude /model command output (stdout)
  updateSessionModelsFromRawBatch(store, processedMessages, outputMessages);

  // 5. Apply session name updates from custom-title messages
  const nameUpdates = extractSessionNameUpdates(rawEnvelopes);
  applySessionNameUpdates(store, nameUpdates);

  // 5b. Apply git branch updates from JSONL message lines (pre-extracted above)
  applySessionGitBranchUpdates(store, gitBranchUpdates);

  // 6. Update session status from last message
  updateSessionStatus(store, rawEnvelopes);

  // 7. Update pending permissions after manual SQLite writes to avoid nested transactions
  if (hasPermissionUpdates) {
    updatePendingPermissions(store, permissionRequests, resolvedToolUseIds);
  }

  // 8. Update artifacts in TinyBase if viewing the session
  updateArtifactsInStore(store, artifacts);

  // 9. Merge TaskUpdate changes into existing todos artifacts
  // This handles TaskUpdate in a different batch than TaskCreate
  mergeTaskUpdatesIntoArtifacts(store, rawEnvelopes);

  // Get last message for acknowledgment
  const lastInfo = getLastMessageInfo(rawEnvelopes);

  const deviceId = store.getValue('device') as string | undefined;
  console.log('[handlers] messages processed:', {
    deviceId: deviceId ?? 'unknown',
    batchId,
    workstationId,
    rawCount: rawEnvelopes.length,
    processedCount: processedMessages.length,
    projectsReferenced: rawProjects.size,
    projectsCreated,
    sessionsUpdated: metadataUpdates.size,
    sessionNamesUpdated: nameUpdates.length,
  });

  return lastInfo;
}

/**
 * Get existing message counts for sessions in the batch.
 */
function getExistingMessageCountsFromRaw(
  store: Store,
  envelopes: RawMessageEnvelope[]
): Map<string, number> {
  const counts = new Map<string, number>();
  const sessionIds = new Set(envelopes.map((e) => e.sessionId));

  for (const sessionId of sessionIds) {
    const session = store.getRow('sessions', sessionId);
    const count = typeof session?.message_count === 'number' ? session.message_count : 0;
    counts.set(sessionId, count);
  }

  return counts;
}

/**
 * Write processed messages to SQLite messages table.
 * Uses INSERT ... ON CONFLICT to preserve created_at and update updated_at.
 */
async function writeProcessedMessagesToSQLite(messages: ProcessedMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const columns =
    '(id, session_id, parent_id, type, timestamp, content, stop_reason, usage, raw_json)';
  const valuesPerRow = 9;
  // Stay safely under SQLite variable limits across platforms.
  const maxRowsPerInsert = Math.max(1, Math.floor(900 / valuesPerRow));

  await withTransaction(async () => {
    for (let i = 0; i < messages.length; i += maxRowsPerInsert) {
      const chunk = messages.slice(i, i + maxRowsPerInsert);
      const placeholders = chunk
        .map(() => `(${new Array(valuesPerRow).fill('?').join(', ')})`)
        .join(', ');
      const sql = `INSERT INTO messages ${columns}
         VALUES ${placeholders}
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           stop_reason = excluded.stop_reason,
           usage = excluded.usage,
           raw_json = excluded.raw_json,
           updated_at = datetime('now')`;
      const params: Array<string | number | null> = [];
      for (const msg of chunk) {
        params.push(
          msg.id,
          msg.session_id,
          msg.parent_id,
          msg.type,
          msg.timestamp,
          msg.content,
          msg.stop_reason,
          msg.usage,
          msg.raw_json
        );
      }
      await executeStatement(sql, params);
      // Yield to keep the UI responsive during large syncs.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
}

/**
 * Write processed messages to TinyBase store for UI reactivity.
 * Note: raw_json is intentionally excluded from TinyBase store for memory optimization.
 */
function writeProcessedMessagesToStore(store: Store, messages: ProcessedMessage[]): void {
  store.transaction(() => {
    for (const msg of messages) {
      // Note: 'id' is NOT included as cell data - it's the row ID (rowIdColumnName: 'id')
      const row: Record<string, string | number> = {
        session_id: msg.session_id,
        parent_id: msg.parent_id,
        type: msg.type,
        timestamp: msg.timestamp,
        content: msg.content,
        stop_reason: msg.stop_reason,
        usage: msg.usage,
        // raw_json excluded for memory optimization
      };

      // Add local command fields if present
      if (msg.subtype) {
        row.subtype = msg.subtype;
      }
      if (msg.command_name) {
        row.command_name = msg.command_name;
      }
      if (msg.command_args) {
        row.command_args = msg.command_args;
      }
      if (msg.stdout !== undefined) {
        row.stdout = msg.stdout;
      }
      if (msg.stderr !== undefined) {
        row.stderr = msg.stderr;
      }

      store.setRow('messages', msg.id, row);
    }
  });
}

/**
 * Merge late-arriving output messages into existing command rows in TinyBase.
 * This handles outputs that arrive in a different batch than their parent command.
 * Uses append logic to preserve multiple outputs for the same command.
 */
function mergeOutputsIntoExistingCommands(store: Store, outputs: ProcessedMessage[]): void {
  if (outputs.length === 0) return;

  store.transaction(() => {
    for (const output of outputs) {
      const parentId = output.parent_id;
      if (!parentId) continue;

      // Check if parent command exists in TinyBase
      const parentRow = store.getRow('messages', parentId);
      if (!parentRow || Object.keys(parentRow).length === 0) {
        // Parent not in TinyBase yet - will be merged when session reloads from SQLite
        continue;
      }

      // Only merge if parent is a local_command
      if (parentRow.subtype !== 'local_command') {
        continue;
      }

      // Build partial update with append logic
      const partial: Record<string, string> = {};

      if (output.stdout) {
        const existingStdout = parentRow.stdout as string | undefined;
        if (existingStdout) {
          partial.stdout = existingStdout + '\n' + output.stdout;
        } else {
          partial.stdout = output.stdout;
        }
      }

      if (output.stderr) {
        const existingStderr = parentRow.stderr as string | undefined;
        if (existingStderr) {
          partial.stderr = existingStderr + '\n' + output.stderr;
        } else {
          partial.stderr = output.stderr;
        }
      }

      if (Object.keys(partial).length > 0) {
        store.setPartialRow('messages', parentId, partial);
      }
    }
  });
}

/**
 * Update session metadata after processing messages.
 */
function updateSessionMetadata(
  store: Store,
  updates: Map<
    string,
    {
      message_count: number;
      last_message_at: string;
      first_message?: string;
    }
  >
): void {
  store.transaction(() => {
    for (const [sessionId, update] of updates) {
      const partial: Record<string, string | number> = {
        message_count: update.message_count,
        last_message_at: update.last_message_at,
      };

      // Only set first_message if provided (new session with first batch)
      if (update.first_message !== undefined) {
        partial.first_message = update.first_message;
      }

      store.setPartialRow('sessions', sessionId, partial);
    }
  });
}

/**
 * Apply session name updates from custom-title messages.
 */
function applySessionNameUpdates(store: Store, updates: SessionNameUpdate[]): void {
  if (updates.length === 0) return;

  store.transaction(() => {
    for (const { sessionId, name } of updates) {
      store.setPartialRow('sessions', sessionId, { name });
    }
  });
}

/**
 * Apply git branch updates from JSONL message lines.
 */
function applySessionGitBranchUpdates(store: Store, updates: SessionGitBranchUpdate[]): void {
  if (updates.length === 0) return;

  store.transaction(() => {
    for (const { sessionId, gitBranch } of updates) {
      store.setPartialRow('sessions', sessionId, { git_branch: gitBranch });
    }
  });
}

/**
 * Update session status based on the last messages in each session.
 * Analyzes both user and assistant messages to determine current session state.
 * Key insight: User message with tool_result means a tool is executing → 'working'.
 */
function updateSessionStatus(store: Store, rawEnvelopes: RawMessageEnvelope[]): void {
  // Group envelopes by session, tracking last user AND last assistant separately
  const lastUserBySession = new Map<string, RawMessageEnvelope>();
  const lastAssistantBySession = new Map<string, RawMessageEnvelope>();

  for (const envelope of rawEnvelopes) {
    const payload = envelope.payload as Record<string, unknown>;
    const msgType = payload.type as string | undefined;

    // Only consider user/assistant messages for status computation
    // (skip summary, queue-operation, file-history-snapshot, etc.)
    if (msgType !== 'user' && msgType !== 'assistant') {
      continue;
    }

    const targetMap = msgType === 'user' ? lastUserBySession : lastAssistantBySession;
    const existing = targetMap.get(envelope.sessionId);
    if (!existing) {
      targetMap.set(envelope.sessionId, envelope);
    } else {
      // Compare timestamps to find the latest
      const existingTs = getEnvelopeTimestamp(existing);
      const currentTs = getEnvelopeTimestamp(envelope);
      if (currentTs >= existingTs) {
        targetMap.set(envelope.sessionId, envelope);
      }
    }
  }

  // Get all session IDs that have either user or assistant messages
  const sessionIds = new Set([...lastUserBySession.keys(), ...lastAssistantBySession.keys()]);

  store.transaction(() => {
    for (const sessionId of sessionIds) {
      const userEnvelope = lastUserBySession.get(sessionId);
      const assistantEnvelope = lastAssistantBySession.get(sessionId);

      // Check if session is open
      const session = store.getRow('sessions', sessionId);
      const isOpen = Number(session?.open) === 1;

      // Parse user message content blocks and timestamp
      let userContentBlocks: ContentBlock[] | undefined;
      let userTimestamp: string | undefined;
      if (userEnvelope) {
        const payload = userEnvelope.payload as Record<string, unknown>;
        userTimestamp = getEnvelopeTimestamp(userEnvelope);
        if (payload.message && typeof payload.message === 'object') {
          const message = payload.message as Record<string, unknown>;
          if (Array.isArray(message.content)) {
            userContentBlocks = message.content as ContentBlock[];
          }
        }
      }

      // Parse assistant message content blocks, stop_reason, and timestamp
      let assistantContentBlocks: ContentBlock[] | undefined;
      let stopReason: string | null | undefined;
      let assistantTimestamp: string | undefined;
      if (assistantEnvelope) {
        const payload = assistantEnvelope.payload as Record<string, unknown>;
        assistantTimestamp = getEnvelopeTimestamp(assistantEnvelope);
        if (payload.message && typeof payload.message === 'object') {
          const message = payload.message as Record<string, unknown>;
          if (Array.isArray(message.content)) {
            assistantContentBlocks = message.content as ContentBlock[];
          }
          stopReason = message.stop_reason as string | undefined;
        }
      }

      // Compute status using consolidated function
      const statusInfo = computeSessionStatus({
        lastAssistantMsg: assistantContentBlocks
          ? {
              contentBlocks: assistantContentBlocks,
              stopReason,
              timestamp: assistantTimestamp ?? '',
            }
          : undefined,
        lastUserMsg: userContentBlocks
          ? { contentBlocks: userContentBlocks, timestamp: userTimestamp ?? '' }
          : undefined,
        isOpen,
      });

      // Update session status
      store.setPartialRow('sessions', sessionId, {
        status: statusInfo.status,
        status_detail: statusInfo.label,
      });
    }
  });
}

/**
 * Extract timestamp from a raw envelope payload.
 */
function getEnvelopeTimestamp(envelope: RawMessageEnvelope): string {
  const payload = envelope.payload as Record<string, unknown>;
  return (payload.timestamp as string) ?? '';
}

// =============================================================================
// Permission Request Handling
// =============================================================================

/**
 * Update pending permissions for sessions based on permission requests and tool results.
 * - Adds pending permission when type: 'permission_request' is received
 * - Clears pending permission when tool_result for that toolUseId is received
 */
function updatePendingPermissions(
  store: Store,
  permissionRequests: Map<string, PermissionRequestLine>,
  resolvedToolUseIds: Map<string, Set<string>>
): void {
  if (permissionRequests.size === 0 && resolvedToolUseIds.size === 0) {
    return;
  }

  store.transaction(() => {
    // First, clear any pending permissions that have been resolved
    for (const [sessionId, toolUseIds] of resolvedToolUseIds) {
      const session = store.getRow('sessions', sessionId);
      const pendingJson = session?.pending_permission as string | undefined;
      if (pendingJson) {
        try {
          const pending = JSON.parse(pendingJson) as { toolUseId: string };
          if (toolUseIds.has(pending.toolUseId)) {
            // This permission was resolved, clear it
            store.setPartialRow('sessions', sessionId, {
              pending_permission: '',
            });
            debugLog('permissions', 'cleared resolved permission', {
              sessionId,
              toolUseId: pending.toolUseId,
            });
          }
        } catch {
          // Invalid JSON, clear it anyway
          store.setPartialRow('sessions', sessionId, {
            pending_permission: '',
          });
        }
      }
    }

    // Then, set new pending permissions
    for (const [sessionId, request] of permissionRequests) {
      // If a tool_result for this toolUseId is in the same batch, ignore this request.
      // This can happen with out-of-order delivery (separate watchers) or reconnect replays.
      const resolvedInBatch = resolvedToolUseIds.get(sessionId);
      if (resolvedInBatch?.has(request.toolUseId)) {
        debugLog('permissions', 'ignored resolved permission request', {
          sessionId,
          toolUseId: request.toolUseId,
          toolName: request.toolName,
        });
        continue;
      }

      // Prevent stale/out-of-order permission events from overwriting newer pending state.
      // Keep the newest permission_request per session by comparing ISO timestamps.
      const session = store.getRow('sessions', sessionId);
      const existingJson = session?.pending_permission as string | undefined;
      if (existingJson) {
        try {
          const existing = JSON.parse(existingJson) as { timestamp?: unknown };
          if (
            typeof existing.timestamp === 'string' &&
            existing.timestamp.localeCompare(request.timestamp) > 0
          ) {
            debugLog('permissions', 'ignored stale permission request', {
              sessionId,
              toolUseId: request.toolUseId,
              toolName: request.toolName,
              existingTs: existing.timestamp,
              incomingTs: request.timestamp,
            });
            continue;
          }
        } catch {
          // If existing JSON is invalid, we'll overwrite it below.
        }
      }

      // Store the pending permission as JSON in the session row
      store.setPartialRow('sessions', sessionId, {
        pending_permission: JSON.stringify({
          toolUseId: request.toolUseId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          permissionMode: request.permissionMode,
          timestamp: request.timestamp,
        }),
      });

      debugLog('permissions', 'stored pending permission', {
        sessionId,
        toolUseId: request.toolUseId,
        toolName: request.toolName,
      });
    }
  });
}

// =============================================================================
// Artifact Updates
// =============================================================================

/**
 * Update TinyBase artifacts.
 * Web: Write all artifacts (OPFS persists entire store)
 * Native: Write only active session artifacts (loaded on-demand from SQLite)
 * SQLite writes are handled earlier in the batch to avoid nested transactions.
 *
 * For todos artifacts, merges new tasks with existing ones (accumulation).
 * For other artifacts, replaces the content.
 */
function updateArtifactsInStore(store: Store, artifacts: ExtractedArtifact[]): void {
  if (artifacts.length === 0) {
    return;
  }

  const activeSessionId = store.getValue('active_session_id') as string;

  for (const artifact of artifacts) {
    // Web: Write all artifacts (no SQLite fallback)
    // Native: Only write for active session (loaded from SQLite on demand)
    if (Platform.OS !== 'web' && artifact.sessionId !== activeSessionId) {
      continue;
    }

    // For todos artifacts from TaskCreate, merge new tasks with existing ones
    // TodoWrite (no IDs) uses replace semantics, TaskCreate (has IDs) uses accumulation
    if (artifact.type === 'todos') {
      const newTodos = parseTodosContent(artifact.content);
      const hasIds = newTodos.some((t) => t.id);

      // Only merge if new todos have IDs (TaskCreate) and existing artifact exists
      if (hasIds) {
        const existingRow = store.getRow('artifacts', artifact.id);
        if (existingRow && Object.keys(existingRow).length > 0) {
          const existingContent = existingRow.content as string | undefined;
          if (existingContent) {
            const existingTodos = parseTodosContent(existingContent);

            // Merge: add new tasks that don't exist (by ID)
            const existingIds = new Set(existingTodos.map((t) => t.id).filter(Boolean));
            const mergedTodos = [...existingTodos];

            for (const newTodo of newTodos) {
              if (newTodo.id && !existingIds.has(newTodo.id)) {
                mergedTodos.push(newTodo);
              }
            }

            // Update with merged content
            store.setPartialRow('artifacts', artifact.id, {
              content: JSON.stringify(mergedTodos),
              source_message_id: artifact.sourceMessageId,
              updated_at: new Date().toISOString(),
            });

            debugLog('artifacts', 'merged todos into existing', {
              artifactId: artifact.id,
              existingCount: existingTodos.length,
              newCount: newTodos.length,
              mergedCount: mergedTodos.length,
            });
            continue;
          }
        }
      }
      // TodoWrite (no IDs) falls through to full upsert (replace semantics)
    }

    // For non-todos or no existing artifact, do a full upsert
    upsertArtifactToStore(store, artifact);
    debugLog('artifacts', 'updated TinyBase', {
      artifactId: artifact.id,
      sessionId: artifact.sessionId,
      platform: Platform.OS,
    });
  }
}

/**
 * Merge TaskUpdate changes into existing todos artifacts.
 * This handles the case where TaskUpdate comes in a different batch than TaskCreate.
 */
function mergeTaskUpdatesIntoArtifacts(store: Store, envelopes: RawMessageEnvelope[]): void {
  const taskUpdates = extractTaskUpdatesFromBatch(envelopes);
  if (taskUpdates.length === 0) {
    return;
  }

  const activeSessionId = store.getValue('active_session_id') as string;

  // Group updates by session
  const updatesBySession = new Map<string, typeof taskUpdates>();
  for (const update of taskUpdates) {
    const existing = updatesBySession.get(update.sessionId) ?? [];
    existing.push(update);
    updatesBySession.set(update.sessionId, existing);
  }

  for (const [sessionId, updates] of updatesBySession) {
    // Only process for relevant sessions
    if (Platform.OS !== 'web' && sessionId !== activeSessionId) {
      continue;
    }

    const artifactId = `${sessionId}:todos`;
    const existingRow = store.getRow('artifacts', artifactId);

    if (!existingRow || Object.keys(existingRow).length === 0) {
      // No existing todos artifact to merge into
      continue;
    }

    const existingContent = existingRow.content as string | undefined;
    if (!existingContent) {
      continue;
    }

    const existingTodos = parseTodosContent(existingContent);
    if (existingTodos.length === 0) {
      continue;
    }

    const mergedTodos = applyTaskUpdatesToTodos(existingTodos, updates);
    if (mergedTodos) {
      // Update the artifact with merged todos
      store.setPartialRow('artifacts', artifactId, {
        content: JSON.stringify(mergedTodos),
        updated_at: new Date().toISOString(),
      });

      debugLog('artifacts', 'merged TaskUpdate into existing todos', {
        artifactId,
        sessionId,
        updatesApplied: updates.length,
      });
    }
  }
}
