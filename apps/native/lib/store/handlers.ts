/**
 * Store update handlers for Socket.IO events.
 * Processes incoming data and updates both SQLite (source of truth) and TinyBase (UI reactivity).
 */

import * as Crypto from 'expo-crypto';
import type { Row, Store } from 'tinybase';
import type { RawMessageEnvelope, RawMessagesBatchPayload } from '@arc0/types';
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
  extractSessionNameUpdates,
  getLastMessageInfo,
  transformRawBatchWithOutputs,
  type PermissionRequestLine,
  type SessionNameUpdate,
} from '../socket/transformer';
import { extractArtifactsFromRawBatch, type ExtractedArtifact } from '../socket/artifact-extractor';
import { executeStatement, getDbInstance, withTransaction } from './persister';
import { upsertArtifactToStore, writeArtifactsToSQLite } from './artifacts-loader';
import { computeSessionStatus } from './status';

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
          store.setRow('projects', projectId, toRow({
            workstation_id: workstationId,
            path: session.cwd,
            name: projectName,
            starred: 0,
          }));
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
function upsertSession(store: Store, session: SessionData, workstationId: string, projectId?: string): void {
  const existing = store.getRow('sessions', session.id);

  if (existing && Object.keys(existing).length > 0) {
    // Update existing - preserves name, first_message, message_count, etc.
    // Note: name intentionally excluded - only set via custom-title messages
    store.setPartialRow('sessions', session.id, {
      project_id: projectId ?? '',
      model: session.model ?? '',
      git_branch: session.gitBranch ?? '',
      started_at: session.startedAt,
      open: 1,
      workstation_id: workstationId,
    });
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
  const { merged: processedMessages, outputs: outputMessages, orphanedOutputs } = transformRawBatchWithOutputs(rawEnvelopes);

  debugLog('messages', 'transformed batch', {
    batchId,
    inputCount: rawEnvelopes.length,
    outputCount: processedMessages.length,
    outputsCount: outputMessages.length,
    orphanedCount: orphanedOutputs.length,
    filtered: rawEnvelopes.length - processedMessages.length - outputMessages.length,
    messageTypes: processedMessages.map((m) => m.type),
  });

  // Pre-extract permission updates for early-return batches and to avoid re-walking envelopes
  const permissionRequests = extractPermissionRequests(rawEnvelopes);
  const resolvedToolUseIds = extractResolvedToolUseIds(rawEnvelopes);
  const hasPermissionUpdates = permissionRequests.size > 0 || resolvedToolUseIds.size > 0;

  if (processedMessages.length === 0 && outputMessages.length === 0) {
    // All lines were non-message types (summary, file-history-snapshot, permission_request, etc.)
    if (hasPermissionUpdates) {
      updatePendingPermissions(store, permissionRequests, resolvedToolUseIds);
    }
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
      store.setRow('projects', projectId, toRow({
        ...project,
        workstation_id: workstationId,
        path, // Store raw path
      }));
      projectsCreated++;
    }
  }

  // 3. Write only active session messages to TinyBase (UI reactivity)
  const activeSessionId = store.getValue('active_session_id') as string | undefined;
  const activeMessages = activeSessionId
    ? processedMessages.filter((m) => m.session_id === activeSessionId)
    : [];
  if (activeMessages.length > 0) {
    writeProcessedMessagesToStore(store, activeMessages);
  }
  debugLog('messages', 'saved to TinyBase (active only)', {
    batchId,
    count: activeMessages.length,
    activeSessionId,
  });

  // 2b. Merge late-arriving (orphaned) outputs into existing command rows in TinyBase
  // This handles outputs that arrive in a different batch than their parent command
  // NOTE: We only merge orphanedOutputs, NOT all outputMessages, to avoid duplicating
  // outputs that were already merged in-batch by transformRawBatchWithOutputs
  const activeOrphanedOutputs = activeSessionId
    ? orphanedOutputs.filter((m) => m.session_id === activeSessionId)
    : [];
  if (activeOrphanedOutputs.length > 0) {
    mergeOutputsIntoExistingCommands(store, activeOrphanedOutputs);
    debugLog('messages', 'merged orphaned outputs into existing commands', {
      batchId,
      orphanedCount: activeOrphanedOutputs.length,
      activeSessionId,
    });
  }

  // 4. Update session metadata
  const metadataUpdates = calculateSessionMetadataFromRaw(rawEnvelopes, existingCounts);
  updateSessionMetadata(store, metadataUpdates);

  // 5. Apply session name updates from custom-title messages
  const nameUpdates = extractSessionNameUpdates(rawEnvelopes);
  applySessionNameUpdates(store, nameUpdates);

  // 6. Update session status from last message
  updateSessionStatus(store, rawEnvelopes);

  // 7. Update pending permissions after manual SQLite writes to avoid nested transactions
  if (hasPermissionUpdates) {
    updatePendingPermissions(store, permissionRequests, resolvedToolUseIds);
  }

  // 8. Update artifacts in TinyBase if viewing the session
  updateArtifactsInStore(store, artifacts);

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
  await withTransaction(async () => {
    for (const msg of messages) {
      await executeStatement(
        `INSERT INTO messages (id, session_id, parent_id, type, timestamp, content, stop_reason, usage, raw_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           stop_reason = excluded.stop_reason,
           usage = excluded.usage,
           raw_json = excluded.raw_json,
           updated_at = datetime('now')`,
        [
          msg.id,
          msg.session_id,
          msg.parent_id,
          msg.type,
          msg.timestamp,
          msg.content,
          msg.stop_reason,
          msg.usage,
          msg.raw_json,
        ]
      );
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
 * Update session status based on the last message in each session.
 * Analyzes assistant messages to determine current session state.
 */
function updateSessionStatus(store: Store, rawEnvelopes: RawMessageEnvelope[]): void {
  // Group envelopes by session and find the last user/assistant message for each
  const lastEnvelopeBySession = new Map<string, RawMessageEnvelope>();

  for (const envelope of rawEnvelopes) {
    const payload = envelope.payload as Record<string, unknown>;
    const msgType = payload.type as string | undefined;

    // Only consider user/assistant messages for status computation
    // (skip summary, queue-operation, file-history-snapshot, etc.)
    if (msgType !== 'user' && msgType !== 'assistant') {
      continue;
    }

    const existing = lastEnvelopeBySession.get(envelope.sessionId);
    if (!existing) {
      lastEnvelopeBySession.set(envelope.sessionId, envelope);
    } else {
      // Compare timestamps to find the latest
      const existingTs = getEnvelopeTimestamp(existing);
      const currentTs = getEnvelopeTimestamp(envelope);
      if (currentTs >= existingTs) {
        lastEnvelopeBySession.set(envelope.sessionId, envelope);
      }
    }
  }

  store.transaction(() => {
    for (const [sessionId, envelope] of lastEnvelopeBySession) {
      const payload = envelope.payload as Record<string, unknown>;
      const msgType = payload.type as string;

      // Check if session is open
      const session = store.getRow('sessions', sessionId);
      const isOpen = Number(session?.open) === 1;

      // Parse content blocks
      let contentBlocks: ContentBlock[] = [];
      if (payload.message && typeof payload.message === 'object') {
        const message = payload.message as Record<string, unknown>;
        if (Array.isArray(message.content)) {
          contentBlocks = message.content as ContentBlock[];
        }
      }

      // Get stop_reason
      const stopReason = payload.message
        ? ((payload.message as Record<string, unknown>).stop_reason as string | undefined)
        : undefined;

      // Compute status
      const statusInfo = computeSessionStatus({
        type: msgType,
        contentBlocks,
        stopReason,
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
 * Update TinyBase artifacts for the active session.
 * SQLite writes are handled earlier in the batch to avoid nested transactions.
 */
function updateArtifactsInStore(store: Store, artifacts: ExtractedArtifact[]): void {
  if (artifacts.length === 0) {
    return;
  }

  const activeSessionId = store.getValue('active_session_id') as string;
  if (!activeSessionId) {
    return;
  }

  for (const artifact of artifacts) {
    if (artifact.sessionId === activeSessionId) {
      upsertArtifactToStore(store, artifact);
      debugLog('artifacts', 'updated TinyBase for active session', {
        artifactId: artifact.id,
        sessionId: artifact.sessionId,
      });
    }
  }
}
