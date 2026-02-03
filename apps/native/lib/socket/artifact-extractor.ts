/**
 * Artifact extractor for raw JSONL message batches.
 * Extracts TodoWrite, TaskCreate/TaskUpdate, and ExitPlanMode tool calls from session messages.
 */

import type { RawMessageEnvelope } from '@arc0/types';

// =============================================================================
// Types
// =============================================================================

export interface ExtractedArtifact {
  /** Unique ID: <sessionId>:plan or <sessionId>:todos */
  id: string;
  /** Session this artifact belongs to */
  sessionId: string;
  /** Type of artifact */
  type: 'plan' | 'todos';
  /** Provider (e.g., 'claude', 'codex') */
  provider: string;
  /** JSON stringified content */
  content: string;
  /** Message ID where this artifact was extracted from */
  sourceMessageId: string;
}

export interface TodoItem {
  /** Task ID for matching with TaskUpdate */
  id?: string;
  content: string;
  status: 'pending' | 'in_progress' | 'completed';
  activeForm?: string;
}

interface TaskCreateInput {
  subject: string;
  description?: string;
  activeForm?: string;
}

interface TaskUpdateInput {
  taskId: string;
  status?: 'pending' | 'in_progress' | 'completed';
  subject?: string;
  description?: string;
  activeForm?: string;
}

interface TaskToolResult {
  task?: {
    id: string;
    subject?: string;
  };
}

// =============================================================================
// Raw Payload Type Guards
// =============================================================================

interface RawContentBlock {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
}

interface RawToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string;
}

interface RawAssistantMessage {
  type: 'assistant';
  uuid: string;
  timestamp: string;
  message: {
    content: RawContentBlock[];
  };
}

interface RawUserMessage {
  type: 'user';
  uuid: string;
  timestamp: string;
  message: {
    content: (RawContentBlock | RawToolResultBlock)[];
  };
  /** Task tool results contain the task data here, not in message.content */
  toolUseResult?: {
    task?: {
      id: string;
      subject?: string;
    };
  };
}

function isAssistantMessage(payload: unknown): payload is RawAssistantMessage {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.type === 'assistant' && typeof p.uuid === 'string';
}

function isUserMessage(payload: unknown): payload is RawUserMessage {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.type === 'user' && typeof p.uuid === 'string';
}

function isTodoWriteBlock(block: RawContentBlock): boolean {
  return block.type === 'tool_use' && block.name === 'TodoWrite';
}

function isExitPlanModeBlock(block: RawContentBlock): boolean {
  return block.type === 'tool_use' && block.name === 'ExitPlanMode';
}

function isTaskCreateBlock(block: RawContentBlock): boolean {
  return block.type === 'tool_use' && block.name === 'TaskCreate';
}

function isTaskUpdateBlock(block: RawContentBlock): boolean {
  return block.type === 'tool_use' && block.name === 'TaskUpdate';
}

function isToolResultBlock(
  block: RawContentBlock | RawToolResultBlock
): block is RawToolResultBlock {
  return block.type === 'tool_result' && 'tool_use_id' in block;
}

function parseToolResultContent(content: string | undefined): TaskToolResult | null {
  if (!content) return null;
  try {
    return JSON.parse(content) as TaskToolResult;
  } catch {
    return null;
  }
}

// =============================================================================
// Helper Extraction Functions
// =============================================================================

/**
 * Group envelopes by session ID for processing.
 */
function groupBySession(envelopes: RawMessageEnvelope[]): Map<string, RawMessageEnvelope[]> {
  const grouped = new Map<string, RawMessageEnvelope[]>();
  for (const envelope of envelopes) {
    const existing = grouped.get(envelope.sessionId) ?? [];
    existing.push(envelope);
    grouped.set(envelope.sessionId, existing);
  }
  return grouped;
}

/**
 * Extract todos from TodoWrite tool calls (legacy support).
 */
function extractTodosFromTodoWrite(
  envelopes: RawMessageEnvelope[],
  provider: string
): Map<string, ExtractedArtifact> {
  const result = new Map<string, ExtractedArtifact>();

  for (const envelope of envelopes) {
    const { sessionId, payload } = envelope;

    if (!isAssistantMessage(payload)) {
      continue;
    }

    const { uuid: messageId, message } = payload;
    const contentBlocks = message?.content ?? [];

    for (const block of contentBlocks) {
      if (isTodoWriteBlock(block)) {
        const input = block.input as { todos?: TodoItem[] } | undefined;
        if (input?.todos && Array.isArray(input.todos)) {
          const artifactId = `${sessionId}:todos`;
          result.set(artifactId, {
            id: artifactId,
            sessionId,
            type: 'todos',
            provider,
            content: JSON.stringify(input.todos),
            sourceMessageId: messageId,
          });
        }
      }
    }
  }

  return result;
}

/**
 * Extract tasks from TaskCreate/TaskUpdate tool calls (new task tools).
 * Processes all messages in order to build up the task list state.
 */
function extractTasksFromTaskTools(
  envelopes: RawMessageEnvelope[],
  provider: string
): Map<string, ExtractedArtifact> {
  const result = new Map<string, ExtractedArtifact>();
  const sessionEnvelopes = groupBySession(envelopes);

  for (const [sessionId, sessionMessages] of sessionEnvelopes) {
    // Step 1: Collect TaskCreate calls with their tool_use_id
    // Maps tool_use_id -> TaskCreate input data
    const taskCreates = new Map<string, { input: TaskCreateInput; messageId: string }>();

    // Step 2: Maps tool_use_id -> assigned task ID from tool_result
    const toolUseIdToTaskId = new Map<string, string>();

    // Step 3: Build task list (taskId -> TodoItem)
    const tasks = new Map<string, TodoItem>();

    // Track the latest message ID that modified the task list
    let latestMessageId = '';

    // First pass: collect TaskCreate blocks and their tool_use_ids
    for (const envelope of sessionMessages) {
      const { payload } = envelope;

      if (isAssistantMessage(payload)) {
        const { uuid: messageId, message } = payload;
        const contentBlocks = message?.content ?? [];

        for (const block of contentBlocks) {
          if (isTaskCreateBlock(block) && block.id) {
            const input = block.input as TaskCreateInput | undefined;
            if (input?.subject) {
              taskCreates.set(block.id, { input, messageId });
            }
          }
        }
      }
    }

    // Second pass: match tool_results to get assigned task IDs
    for (const envelope of sessionMessages) {
      const { payload } = envelope;

      if (isUserMessage(payload)) {
        const { message, toolUseResult } = payload;
        const contentBlocks = message?.content ?? [];

        for (const block of contentBlocks) {
          if (isToolResultBlock(block)) {
            const toolUseId = block.tool_use_id;
            // Only process if this is a result for a TaskCreate we tracked
            if (taskCreates.has(toolUseId)) {
              // Task data is in payload.toolUseResult, not block.content
              if (toolUseResult?.task?.id) {
                toolUseIdToTaskId.set(toolUseId, toolUseResult.task.id);
              }
            }
          }
        }
      }
    }

    // Third pass: build initial task list from TaskCreate + matched IDs
    for (const [toolUseId, { input, messageId }] of taskCreates) {
      const taskId = toolUseIdToTaskId.get(toolUseId);
      if (taskId) {
        tasks.set(taskId, {
          id: taskId,
          content: input.subject,
          status: 'pending',
          activeForm: input.activeForm,
        });
        latestMessageId = messageId;
      }
    }

    // Fourth pass: apply TaskUpdate status changes
    for (const envelope of sessionMessages) {
      const { payload } = envelope;

      if (isAssistantMessage(payload)) {
        const { uuid: messageId, message } = payload;
        const contentBlocks = message?.content ?? [];

        for (const block of contentBlocks) {
          if (isTaskUpdateBlock(block)) {
            const input = block.input as TaskUpdateInput | undefined;
            if (input?.taskId && tasks.has(input.taskId)) {
              const task = tasks.get(input.taskId)!;
              if (input.status) {
                task.status = input.status;
              }
              if (input.subject) {
                task.content = input.subject;
              }
              if (input.activeForm) {
                task.activeForm = input.activeForm;
              }
              latestMessageId = messageId;
            }
          }
        }
      }
    }

    // Step 5: Convert to artifact if we have tasks
    if (tasks.size > 0) {
      const artifactId = `${sessionId}:todos`;
      result.set(artifactId, {
        id: artifactId,
        sessionId,
        type: 'todos',
        provider,
        content: JSON.stringify(Array.from(tasks.values())),
        sourceMessageId: latestMessageId,
      });
    }
  }

  return result;
}

/**
 * Extract plans from ExitPlanMode tool calls.
 */
function extractPlansFromExitPlanMode(
  envelopes: RawMessageEnvelope[],
  provider: string
): Map<string, ExtractedArtifact> {
  const result = new Map<string, ExtractedArtifact>();

  for (const envelope of envelopes) {
    const { sessionId, payload } = envelope;

    if (!isAssistantMessage(payload)) {
      continue;
    }

    const { uuid: messageId, message } = payload;
    const contentBlocks = message?.content ?? [];

    for (const block of contentBlocks) {
      if (isExitPlanModeBlock(block)) {
        const input = block.input as { plan?: string; allowedPrompts?: unknown[] } | undefined;
        const artifactId = `${sessionId}:plan`;
        result.set(artifactId, {
          id: artifactId,
          sessionId,
          type: 'plan',
          provider,
          content: JSON.stringify({
            plan: input?.plan ?? null,
            allowedPrompts: input?.allowedPrompts ?? [],
          }),
          sourceMessageId: messageId,
        });
      }
    }
  }

  return result;
}

// =============================================================================
// Main Extraction Function
// =============================================================================

/**
 * Extract artifacts from a batch of raw JSONL envelopes.
 * Returns one artifact per type per session (latest wins).
 *
 * Supports:
 * - TodoWrite (legacy) - replaces entire todo list
 * - TaskCreate/TaskUpdate (new) - incremental task management
 * - ExitPlanMode - plan artifacts
 *
 * @param envelopes - Raw message envelopes from Socket.IO
 * @param provider - Provider name (e.g., 'claude')
 * @returns Array of extracted artifacts
 */
export function extractArtifactsFromRawBatch(
  envelopes: RawMessageEnvelope[],
  provider: string = 'claude'
): ExtractedArtifact[] {
  const artifactMap = new Map<string, ExtractedArtifact>();

  // Extract from legacy TodoWrite (backward compatibility)
  const todoWriteArtifacts = extractTodosFromTodoWrite(envelopes, provider);
  for (const [key, artifact] of todoWriteArtifacts) {
    artifactMap.set(key, artifact);
  }

  // Extract from new TaskCreate/TaskUpdate (takes precedence over TodoWrite)
  const taskArtifacts = extractTasksFromTaskTools(envelopes, provider);
  for (const [key, artifact] of taskArtifacts) {
    artifactMap.set(key, artifact);
  }

  // Extract plans from ExitPlanMode
  const planArtifacts = extractPlansFromExitPlanMode(envelopes, provider);
  for (const [key, artifact] of planArtifacts) {
    artifactMap.set(key, artifact);
  }

  return Array.from(artifactMap.values());
}

/**
 * Parse artifact content back to typed data.
 */
export function parseTodosContent(content: string): TodoItem[] {
  try {
    return JSON.parse(content) as TodoItem[];
  } catch {
    return [];
  }
}

/**
 * Parse plan artifact content.
 */
export function parsePlanContent(content: string): {
  plan: string | null;
  allowedPrompts: unknown[];
} {
  try {
    return JSON.parse(content) as { plan: string | null; allowedPrompts: unknown[] };
  } catch {
    return { plan: null, allowedPrompts: [] };
  }
}

/**
 * Extracted TaskUpdate info for merging with existing artifacts.
 */
export interface TaskUpdateInfo {
  sessionId: string;
  taskId: string;
  status?: 'pending' | 'in_progress' | 'completed';
  subject?: string;
  activeForm?: string;
}

/**
 * Extract TaskUpdate calls from a batch (without requiring TaskCreate).
 * Used for merging updates into existing artifacts.
 */
export function extractTaskUpdatesFromBatch(envelopes: RawMessageEnvelope[]): TaskUpdateInfo[] {
  const updates: TaskUpdateInfo[] = [];

  for (const envelope of envelopes) {
    const { sessionId, payload } = envelope;

    if (!isAssistantMessage(payload)) {
      continue;
    }

    const { message } = payload;
    const contentBlocks = message?.content ?? [];

    for (const block of contentBlocks) {
      if (isTaskUpdateBlock(block)) {
        const input = block.input as TaskUpdateInput | undefined;
        if (input?.taskId) {
          updates.push({
            sessionId,
            taskId: input.taskId,
            status: input.status,
            subject: input.subject,
            activeForm: input.activeForm,
          });
        }
      }
    }
  }

  return updates;
}

/**
 * Apply TaskUpdate changes to existing todos.
 * Returns updated todos array, or null if no changes were made.
 */
export function applyTaskUpdatesToTodos(
  existingTodos: TodoItem[],
  updates: TaskUpdateInfo[]
): TodoItem[] | null {
  if (updates.length === 0) {
    return null;
  }

  let modified = false;
  const todos = existingTodos.map((todo) => ({ ...todo }));

  for (const update of updates) {
    // Find task by ID
    const index = todos.findIndex((t) => t.id === update.taskId);
    if (index >= 0) {
      const task = todos[index];
      if (update.status && task.status !== update.status) {
        task.status = update.status;
        modified = true;
      }
      if (update.subject && task.content !== update.subject) {
        task.content = update.subject;
        modified = true;
      }
      if (update.activeForm && task.activeForm !== update.activeForm) {
        task.activeForm = update.activeForm;
        modified = true;
      }
    }
  }

  return modified ? todos : null;
}
