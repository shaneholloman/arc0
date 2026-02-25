/**
 * Store update handlers for Socket.IO events.
 *
 * Base sends canonical timeline items (messages + session events).
 * Native is responsible for:
 * - persisting canonical messages (SQLite source-of-truth)
 * - maintaining UI state (TinyBase, active-session scoped on native)
 * - domain reducers (status, pending approvals, etc.)
 */

import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import type { Row, Store } from 'tinybase';
import type {
  PermissionRequestEvent,
  SessionNameChangeEvent,
  TimelineBatchPayload,
  TimelineItem,
  SocketMessage,
} from '@arc0/types';
import type { SessionData, SessionsSyncPayload } from '../socket/types';
import type { ContentBlock } from '../types/session';
import type { ProcessedMessage, ProcessedProject, ProcessedWorkstation } from './processed';
import { executeStatement, getDbInstance, withTransaction } from './persister';
import { computeSessionStatus } from './session-status';

// =============================================================================
// Debug Logging
// =============================================================================

function debugLog(tag: string, message: string, data?: unknown): void {
  if (__DEV__) {
    console.log(`[${tag}] ${message}`, data ?? '');
  }
}

const PROJECT_ID_HASH_CHARS = 16;
const FIRST_MESSAGE_PREVIEW_CHARS = 200;
// SQLite has a bound-variable limit (commonly 999). Keep headroom across platforms.
const SQLITE_SAFE_MAX_VARIABLES = 900;
// Must match the number of columns inserted in writeProcessedMessagesToSQLite.
const SQLITE_MESSAGE_INSERT_VALUES_PER_ROW = 9;

// =============================================================================
// Message Batch Processing Queue
// =============================================================================
// Serializes message batch processing to prevent concurrent SQLite transactions.
// expo-sqlite's withTransactionAsync doesn't support nested transactions, so
// when multiple Socket.IO batches arrive rapidly (e.g. on reconnection), we
// need to process them sequentially.

export interface MessagesBatchResult {
  lastMessageId: string;
  lastMessageTs: string;
}

type BatchTask = {
  store: Store;
  payload: TimelineBatchPayload;
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
  return hash.slice(0, PROJECT_ID_HASH_CHARS);
}

// =============================================================================
// Helpers
// =============================================================================

function toRow(obj: ProcessedWorkstation | ProcessedProject | Record<string, unknown>): Row {
  return obj as unknown as Row;
}

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
// Sessions Sync Handler
// =============================================================================

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

  // Generate project IDs for all sessions (async)
  const projectIdMap = new Map<string, string>(); // path -> hash ID
  for (const session of sessions) {
    if (session.cwd && !projectIdMap.has(session.cwd)) {
      const projectId = await generateProjectId(workstationId, session.cwd);
      projectIdMap.set(session.cwd, projectId);
    }
  }

  let projectsCreated = 0;

  store.transaction(() => {
    // 1) Upsert projects from sessions
    for (const session of sessions) {
      if (!session.cwd) continue;
      const projectId = projectIdMap.get(session.cwd);
      if (!projectId) continue;

      const existingProject = store.getRow('projects', projectId);
      if (!existingProject || Object.keys(existingProject).length === 0) {
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

    // 2) Upsert sessions
    for (const session of sessions) {
      const projectId = session.cwd ? projectIdMap.get(session.cwd) : undefined;
      upsertSession(store, session, workstationId, projectId);
    }

    // 3) Close sessions no longer in list (same workstation only)
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

function upsertSession(
  store: Store,
  session: SessionData,
  workstationId: string,
  projectId?: string
): void {
  const existing = store.getRow('sessions', session.id);
  const interactive = session.interactive ? 1 : 0;

  if (existing && Object.keys(existing).length > 0) {
    const partial: Record<string, string | number> = {
      project_id: projectId ?? '',
      git_branch: session.gitBranch ?? '',
      started_at: session.startedAt,
      open: 1,
      interactive,
      workstation_id: workstationId,
      provider: session.provider,
    };

    // Preserve existing model if Base doesn't provide one.
    if (session.model) {
      partial.model = session.model;
    }

    // Update name if Base provides one (from /rename or custom-title JSONL).
    if (session.name) {
      partial.name = session.name;
    }

    store.setPartialRow('sessions', session.id, partial);
  } else {
    store.setRow('sessions', session.id, {
      name: session.name ?? '',
      project_id: projectId ?? '',
      model: session.model ?? '',
      git_branch: session.gitBranch ?? '',
      started_at: session.startedAt,
      open: 1,
      interactive,
      workstation_id: workstationId,
      provider: session.provider,
      message_count: 0,
      first_message: '',
      last_message_at: '',
      ended_at: '',
      status: 'idle',
      status_detail: 'Ready',
      pending_permission: '',
    });
  }
}

// =============================================================================
// Messages Batch Handler (canonical timeline)
// =============================================================================

export async function handleMessagesBatch(
  store: Store,
  payload: TimelineBatchPayload
): Promise<MessagesBatchResult> {
  return new Promise((resolve, reject) => {
    batchQueue.push({ store, payload, resolve, reject });
    processBatchQueue();
  });
}

function isUserOrAssistantMessage(
  msg: SocketMessage
): msg is Extract<SocketMessage, { type: 'user' | 'assistant' }> {
  return msg.type === 'user' || msg.type === 'assistant';
}

function isLocalCommandOutputMessage(msg: SocketMessage): boolean {
  return (
    msg.type === 'system' &&
    msg.subtype === 'local_command' &&
    Boolean((msg as { stdout?: string }).stdout || (msg as { stderr?: string }).stderr) &&
    Boolean(msg.parentUuid) &&
    !Boolean((msg as { commandName?: string }).commandName)
  );
}

function socketMessageToProcessed(msg: SocketMessage): ProcessedMessage {
  const base: ProcessedMessage = {
    id: msg.uuid,
    session_id: msg.sessionId,
    parent_id: msg.parentUuid ?? '',
    type: msg.type,
    timestamp: msg.timestamp,
    content: JSON.stringify(msg.content ?? []),
    stop_reason: msg.type === 'assistant' ? (msg.stopReason ?? '') : '',
    usage: msg.type === 'assistant' ? JSON.stringify(msg.usage ?? {}) : JSON.stringify({}),
    raw_json: JSON.stringify(msg),
  };

  if (msg.type === 'system') {
    if (msg.subtype) {
      base.subtype = msg.subtype;
    }
    if (msg.commandName) {
      base.command_name = msg.commandName;
    }
    if (msg.commandArgs) {
      base.command_args = msg.commandArgs;
    }
    if (msg.stdout !== undefined) {
      base.stdout = msg.stdout;
    }
    if (msg.stderr !== undefined) {
      base.stderr = msg.stderr;
    }
  }

  return base;
}

function getItemTimestamp(item: TimelineItem): string {
  return item.kind === 'message' ? item.message.timestamp : item.event.timestamp;
}

function getLastItemInfo(items: TimelineItem[]): { lastMessageId: string; lastMessageTs: string } {
  if (items.length === 0) return { lastMessageId: '', lastMessageTs: '' };

  // Items are expected to arrive in chronological order from Base, but we still
  // compute by max timestamp to be resilient to minor reorderings.
  let lastTs = '';
  let lastId = '';
  for (const item of items) {
    const ts = getItemTimestamp(item);
    if (ts >= lastTs) {
      lastTs = ts;
      if (item.kind === 'message') {
        lastId = item.message.uuid;
      }
    }
  }

  return { lastMessageId: lastId, lastMessageTs: lastTs };
}

function extractResolvedToolUseIds(messages: SocketMessage[]): Map<string, Set<string>> {
  const resolved = new Map<string, Set<string>>();

  for (const msg of messages) {
    if (msg.type !== 'user') continue;

    for (const block of msg.content ?? []) {
      if (block.type !== 'tool_result') continue;
      const toolUseId = block.tool_use_id;
      const set = resolved.get(msg.sessionId) ?? new Set<string>();
      set.add(toolUseId);
      resolved.set(msg.sessionId, set);
    }
  }

  return resolved;
}

function extractPermissionRequests(items: TimelineItem[]): Map<string, PermissionRequestEvent> {
  const requests = new Map<string, PermissionRequestEvent>();

  for (const item of items) {
    if (item.kind !== 'session_event') continue;
    if (item.event.type !== 'permission_request') continue;

    const existing = requests.get(item.sessionId);
    if (!existing || existing.timestamp.localeCompare(item.event.timestamp) <= 0) {
      requests.set(item.sessionId, item.event);
    }
  }

  return requests;
}

function extractSessionNameChanges(items: TimelineItem[]): Map<string, SessionNameChangeEvent> {
  const events = new Map<string, SessionNameChangeEvent>();

  for (const item of items) {
    if (item.kind !== 'session_event') continue;
    if (item.event.type !== 'session_name_change') continue;

    const existing = events.get(item.sessionId);
    if (!existing || existing.timestamp.localeCompare(item.event.timestamp) <= 0) {
      events.set(item.sessionId, item.event);
    }
  }

  return events;
}

function applySessionNameChanges(
  store: Store,
  nameChanges: Map<string, SessionNameChangeEvent>,
): void {
  if (nameChanges.size === 0) return;

  store.transaction(() => {
    for (const [sessionId, event] of nameChanges) {
      store.setPartialRow('sessions', sessionId, { name: event.name });
    }
  });
}

function updatePendingPermissions(
  store: Store,
  permissionRequests: Map<string, PermissionRequestEvent>,
  resolvedToolUseIds: Map<string, Set<string>>
): void {
  if (permissionRequests.size === 0 && resolvedToolUseIds.size === 0) return;

  store.transaction(() => {
    // Clear resolved permissions first
    for (const [sessionId, toolUseIds] of resolvedToolUseIds) {
      const session = store.getRow('sessions', sessionId);
      const pendingJson = session?.pending_permission as string | undefined;
      if (!pendingJson) continue;

      try {
        const pending = JSON.parse(pendingJson) as { toolUseId: string };
        if (toolUseIds.has(pending.toolUseId)) {
          store.setPartialRow('sessions', sessionId, { pending_permission: '' });
        }
      } catch {
        store.setPartialRow('sessions', sessionId, { pending_permission: '' });
      }
    }

    // Then set new requests (newest wins)
    for (const [sessionId, request] of permissionRequests) {
      const resolvedInBatch = resolvedToolUseIds.get(sessionId);
      if (resolvedInBatch?.has(request.toolUseId)) {
        continue;
      }

      const session = store.getRow('sessions', sessionId);
      const existingJson = session?.pending_permission as string | undefined;
      if (existingJson) {
        try {
          const existing = JSON.parse(existingJson) as { timestamp?: string };
          if (existing.timestamp && existing.timestamp > request.timestamp) {
            continue;
          }
        } catch {
          // If it's corrupt, overwrite with the new request.
        }
      }

      store.setPartialRow('sessions', sessionId, {
        pending_permission: JSON.stringify({
          toolUseId: request.toolUseId,
          toolName: request.toolName,
          toolInput: request.toolInput,
          permissionMode: request.permissionMode,
          timestamp: request.timestamp,
        }),
      });
    }
  });
}

function mergeLocalCommandOutputsIntoStore(store: Store, outputs: ProcessedMessage[]): void {
  if (outputs.length === 0) return;

  store.transaction(() => {
    for (const output of outputs) {
      const parentId = output.parent_id;
      if (!parentId) continue;

      const parentRow = store.getRow('messages', parentId);
      if (!parentRow || Object.keys(parentRow).length === 0) continue;
      if (parentRow.subtype !== 'local_command') continue;

      const partial: Record<string, string> = {};

      if (output.stdout) {
        const existingStdout = parentRow.stdout as string | undefined;
        partial.stdout = existingStdout ? `${existingStdout}\n${output.stdout}` : output.stdout;
      }
      if (output.stderr) {
        const existingStderr = parentRow.stderr as string | undefined;
        partial.stderr = existingStderr ? `${existingStderr}\n${output.stderr}` : output.stderr;
      }

      if (Object.keys(partial).length > 0) {
        store.setPartialRow('messages', parentId, partial);
      }
    }
  });
}

function calculateSessionMetadataUpdates(
  store: Store,
  items: TimelineItem[],
  messages: SocketMessage[]
): Map<
  string,
  {
    messageCountDelta: number;
    lastItemTs: string;
    firstMessage?: string;
    model?: string;
  }
> {
  const updates = new Map<
    string,
    { messageCountDelta: number; lastItemTs: string; firstMessage?: string; model?: string }
  >();

  // Last item timestamp per session (for cursors)
  for (const item of items) {
    const sessionId = item.kind === 'message' ? item.message.sessionId : item.sessionId;
    const ts = getItemTimestamp(item);
    const existing = updates.get(sessionId);
    if (!existing) {
      updates.set(sessionId, { messageCountDelta: 0, lastItemTs: ts });
    } else if (ts > existing.lastItemTs) {
      existing.lastItemTs = ts;
    }
  }

  // Count only user/assistant messages (system messages do not affect message_count)
  for (const msg of messages) {
    if (!isUserOrAssistantMessage(msg)) continue;

    const existing = updates.get(msg.sessionId) ?? {
      messageCountDelta: 0,
      lastItemTs: msg.timestamp,
    };
    existing.messageCountDelta += 1;
    updates.set(msg.sessionId, existing);

    // Track model updates (best-effort)
    if (msg.type === 'assistant' && msg.model) {
      existing.model = msg.model;
    }
  }

  // First message (only if session has no messages yet)
  const firstMessageSet = new Set<string>();
  for (const msg of messages) {
    if (msg.type !== 'user') continue;
    const sessionId = msg.sessionId;
    if (firstMessageSet.has(sessionId)) continue;

    const session = store.getRow('sessions', sessionId);
    const existingCount = typeof session?.message_count === 'number' ? session.message_count : 0;
    if (existingCount > 0) continue;

    const textBlock = (msg.content ?? []).find((b) => b.type === 'text');
    if (textBlock && textBlock.type === 'text') {
      const update = updates.get(sessionId) ?? { messageCountDelta: 0, lastItemTs: msg.timestamp };
      update.firstMessage = textBlock.text.slice(0, FIRST_MESSAGE_PREVIEW_CHARS);
      updates.set(sessionId, update);
      firstMessageSet.add(sessionId);
    }
  }

  return updates;
}

function updateSessionStatus(store: Store, messages: SocketMessage[]): void {
  if (messages.length === 0) return;

  const lastUserBySession = new Map<string, Extract<SocketMessage, { type: 'user' }>>();
  const lastAssistantBySession = new Map<string, Extract<SocketMessage, { type: 'assistant' }>>();

  for (const msg of messages) {
    if (msg.type === 'user') {
      const existing = lastUserBySession.get(msg.sessionId);
      if (!existing || msg.timestamp >= existing.timestamp) {
        lastUserBySession.set(msg.sessionId, msg);
      }
    } else if (msg.type === 'assistant') {
      const existing = lastAssistantBySession.get(msg.sessionId);
      if (!existing || msg.timestamp >= existing.timestamp) {
        lastAssistantBySession.set(msg.sessionId, msg);
      }
    }
  }

  const sessionIds = new Set<string>([
    ...lastUserBySession.keys(),
    ...lastAssistantBySession.keys(),
  ]);

  store.transaction(() => {
    for (const sessionId of sessionIds) {
      const session = store.getRow('sessions', sessionId);
      const isOpen = session?.open === undefined ? true : Number(session.open) === 1;

      const lastUser = lastUserBySession.get(sessionId);
      const lastAssistant = lastAssistantBySession.get(sessionId);

      // These are structurally compatible with our local ContentBlock type.
      const userContentBlocks = lastUser?.content as unknown as ContentBlock[] | undefined;
      const assistantContentBlocks = lastAssistant?.content as unknown as
        | ContentBlock[]
        | undefined;

      const statusInfo = computeSessionStatus({
        lastAssistantMsg: assistantContentBlocks
          ? {
              contentBlocks: assistantContentBlocks,
              stopReason: lastAssistant?.stopReason,
              timestamp: lastAssistant?.timestamp ?? '',
            }
          : undefined,
        lastUserMsg: userContentBlocks
          ? { contentBlocks: userContentBlocks, timestamp: lastUser?.timestamp ?? '' }
          : undefined,
        isOpen,
      });

      store.setPartialRow('sessions', sessionId, {
        status: statusInfo.status,
        status_detail: statusInfo.label,
      });
    }
  });
}

function parseClaudeModelFromStdout(stdout: string): string | null {
  // Matches e.g. "Set model to Sonnet" / "Kept model as Opus" (+ optional "(…)" suffix).
  const match = stdout.match(/(?:Set model to|Kept model as)\s+([^\n\r(]+)/i);
  const name = match?.[1]?.trim();
  if (!name) return null;

  // Keep values aligned with the existing UI model picker (native-only concept).
  const lower = name.toLowerCase();
  if (lower.startsWith('opus')) return 'opus-4.5';
  if (lower.startsWith('sonnet')) return 'sonnet-4.5';
  if (lower.startsWith('haiku')) return 'haiku-4.5';
  if (lower.startsWith('default')) return 'default';

  return name;
}

async function writeProcessedMessagesToSQLite(messages: ProcessedMessage[]): Promise<void> {
  if (messages.length === 0) return;

  const maxRowsPerInsert = Math.max(
    1,
    Math.floor(SQLITE_SAFE_MAX_VARIABLES / SQLITE_MESSAGE_INSERT_VALUES_PER_ROW)
  );

  const columns =
    '(id, session_id, parent_id, type, timestamp, content, stop_reason, usage, raw_json)';

  await withTransaction(async () => {
    for (let i = 0; i < messages.length; i += maxRowsPerInsert) {
      const chunk = messages.slice(i, i + maxRowsPerInsert);
      const placeholders = chunk
        .map(() => `(${new Array(SQLITE_MESSAGE_INSERT_VALUES_PER_ROW).fill('?').join(', ')})`)
        .join(', ');
      const sql = `INSERT INTO messages ${columns}
        VALUES ${placeholders}
        ON CONFLICT(id) DO UPDATE SET
          content = excluded.content,
          stop_reason = excluded.stop_reason,
          usage = excluded.usage,
          raw_json = excluded.raw_json,
          updated_at = datetime('now')`;

      const params: (string | number | null)[] = [];
      for (const msg of chunk) {
        params.push(
          msg.id,
          msg.session_id,
          msg.parent_id || null,
          msg.type,
          msg.timestamp,
          msg.content,
          msg.stop_reason || null,
          msg.usage || null,
          msg.raw_json || null
        );
      }

      await executeStatement(sql, params);
    }
  });
}

function writeProcessedMessagesToStore(store: Store, messages: ProcessedMessage[]): void {
  if (messages.length === 0) return;

  store.transaction(() => {
    for (const msg of messages) {
      const row: Record<string, string> = {
        session_id: msg.session_id,
        parent_id: msg.parent_id,
        type: msg.type,
        timestamp: msg.timestamp,
        content: msg.content,
        stop_reason: msg.stop_reason,
        usage: msg.usage,
      };

      if (msg.subtype) row.subtype = msg.subtype;
      if (msg.command_name) row.command_name = msg.command_name;
      if (msg.command_args) row.command_args = msg.command_args;
      if (msg.stdout !== undefined) row.stdout = msg.stdout;
      if (msg.stderr !== undefined) row.stderr = msg.stderr;

      store.setRow('messages', msg.id, row);
    }
  });
}

async function handleMessagesBatchInternal(
  store: Store,
  payload: TimelineBatchPayload
): Promise<MessagesBatchResult> {
  const { workstationId, items, batchId } = payload;

  debugLog('messages', 'received batch', {
    batchId,
    workstationId,
    itemCount: items.length,
    sessionIds: [
      ...new Set(items.map((i) => (i.kind === 'message' ? i.message.sessionId : i.sessionId))),
    ],
  });

  if (items.length === 0) {
    return { lastMessageId: '', lastMessageTs: '' };
  }

  // Verify workstation exists - don't auto-create (would fail NOT NULL url constraint)
  const existingWorkstation = store.getRow('workstations', workstationId);
  if (!existingWorkstation || Object.keys(existingWorkstation).length === 0) {
    console.warn(`[handlers] Ignoring messages for unknown workstation: ${workstationId}`);
    return { lastMessageId: '', lastMessageTs: '' };
  }

  const permissionRequests = extractPermissionRequests(items);
  const messages = items
    .filter((i): i is Extract<TimelineItem, { kind: 'message' }> => i.kind === 'message')
    .map((i) => i.message);
  const resolvedToolUseIds = extractResolvedToolUseIds(messages);
  const localCommandOutputMessageIds = new Set(
    messages.filter((msg) => isLocalCommandOutputMessage(msg)).map((msg) => msg.uuid)
  );

  const processedForSQLite = messages.map(socketMessageToProcessed);

  // Native: write all messages to SQLite (source of truth for closed sessions).
  // Web: SQLite path may differ; TinyBase persistence is the primary mechanism.
  const db = getDbInstance();
  if (db) {
    await writeProcessedMessagesToSQLite(processedForSQLite);
    debugLog('messages', 'saved to SQLite', { batchId, count: processedForSQLite.length });
  }

  // TinyBase writes (UI reactivity):
  // - Web: keep all messages in-memory
  // - Native: keep active session only (avoid huge memory spikes on reconnect)
  const activeSessionId = store.getValue('active_session_id') as string | undefined;
  const shouldWriteAll = Platform.OS === 'web';
  const messagesForStore = shouldWriteAll
    ? processedForSQLite
    : activeSessionId
      ? processedForSQLite.filter((m) => m.session_id === activeSessionId)
      : [];

  // Merge local command outputs into their parent command rows.
  // Output messages still persist to SQLite via raw_json.
  const outputsToMerge = messagesForStore.filter((m) => localCommandOutputMessageIds.has(m.id));
  const displayMessages = messagesForStore.filter((m) => !localCommandOutputMessageIds.has(m.id));

  writeProcessedMessagesToStore(store, displayMessages);
  mergeLocalCommandOutputsIntoStore(store, outputsToMerge);

  // Session metadata updates
  const metadataUpdates = calculateSessionMetadataUpdates(store, items, messages);
  store.transaction(() => {
    for (const [sessionId, update] of metadataUpdates) {
      const session = store.getRow('sessions', sessionId);
      const existingCount = typeof session?.message_count === 'number' ? session.message_count : 0;

      const partial: Record<string, string | number> = {
        message_count: existingCount + update.messageCountDelta,
        last_message_at: update.lastItemTs,
      };

      if (update.firstMessage !== undefined) {
        partial.first_message = update.firstMessage;
      }
      if (update.model) {
        partial.model = update.model;
      }

      store.setPartialRow('sessions', sessionId, partial);
    }
  });

  // Best-effort model updates from /model stdout (Claude).
  // This keeps the composer UI in sync even before the next assistant message arrives.
  for (const msg of messages) {
    if (msg.type !== 'system') continue;
    if (!msg.stdout) continue;
    const model = parseClaudeModelFromStdout(msg.stdout);
    if (!model) continue;
    store.setPartialRow('sessions', msg.sessionId, { model });
  }

  // Status + pending permissions
  updateSessionStatus(store, messages);
  updatePendingPermissions(store, permissionRequests, resolvedToolUseIds);

  // Session name changes (from /rename)
  const nameChanges = extractSessionNameChanges(items);
  applySessionNameChanges(store, nameChanges);

  return getLastItemInfo(items);
}
