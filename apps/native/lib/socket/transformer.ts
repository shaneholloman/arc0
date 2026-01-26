/**
 * Transforms raw Claude JSONL lines to ProcessedMessage format.
 * Handles filtering non-message types, flattening nested structure,
 * and converting snake_case to camelCase.
 */

import * as Crypto from 'expo-crypto';
import type { ContentBlock } from '@arc0/types';
import type { RawMessageEnvelope } from '@arc0/types';
import type { ProcessedMessage, ProcessedProject, SessionMetadataUpdate } from './processor';

// =============================================================================
// Debug Logging
// =============================================================================

function debugLog(tag: string, message: string, data?: unknown): void {
  if (__DEV__) {
    console.log(`[${tag}] ${message}`, data ?? '');
  }
}

// =============================================================================
// Raw JSONL Type Guards
// =============================================================================

/**
 * Raw JSONL line from Claude (user or assistant type).
 * Only these types have uuid and message content.
 */
interface RawMessageLine {
  type: 'user' | 'assistant';
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  cwd?: string; // Raw JSONL uses 'cwd', we store as 'path' in ProcessedProject
  sessionId?: string;
  message: {
    role: 'user' | 'assistant';
    content: unknown[] | string;
    usage?: {
      input_tokens: number;
      output_tokens: number;
    };
    stop_reason?: string | null;
  };
}

/**
 * Raw JSONL line for custom session title.
 * This is a metadata message, not a conversation message.
 */
interface CustomTitleLine {
  type: 'custom-title';
  customTitle: string;
  sessionId: string;
}

/**
 * Check if raw payload is a message line (user/assistant).
 */
function isMessageLine(payload: unknown): payload is RawMessageLine {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.type === 'user' || p.type === 'assistant';
}

/**
 * Raw JSONL line with isMeta flag (caveat messages to skip).
 */
interface RawMetaLine {
  isMeta: true;
  type: 'user';
  uuid: string;
}

/**
 * Check if raw payload is a meta line that should be skipped.
 */
function isMetaLine(payload: unknown): payload is RawMetaLine {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.isMeta === true;
}

/**
 * Parse local command from XML content.
 * Returns command name, message, and args if this is a command message.
 */
function parseLocalCommand(
  content: string
): { commandName: string; commandMessage: string; commandArgs: string } | null {
  const nameMatch = content.match(/<command-name>([^<]+)<\/command-name>/);
  const argsMatch = content.match(/<command-args>([^<]*)<\/command-args>/);
  if (!nameMatch) return null;
  return {
    commandName: nameMatch[1],
    commandMessage: nameMatch[1].replace('/', ''),
    commandArgs: argsMatch?.[1] || '',
  };
}

/**
 * Parse command output from XML content.
 * Returns stdout and/or stderr if this is an output message.
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
 * Strip ANSI escape sequences from text for clean display.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '');
}

/**
 * Check if raw payload is a custom-title line.
 */
function isCustomTitleLine(payload: unknown): payload is CustomTitleLine {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.type === 'custom-title' && typeof p.customTitle === 'string';
}

/**
 * Permission request payload from daemon.
 * Sent through the messages channel with type: 'permission_request'.
 */
export interface PermissionRequestLine {
  type: 'permission_request';
  toolUseId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  permissionMode: string;
  timestamp: string;
}

/**
 * Check if raw payload is a permission request.
 */
export function isPermissionRequestLine(payload: unknown): payload is PermissionRequestLine {
  if (!payload || typeof payload !== 'object') return false;
  const p = payload as Record<string, unknown>;
  return p.type === 'permission_request' && typeof p.toolUseId === 'string';
}

// =============================================================================
// Content Block Transformation
// =============================================================================

/**
 * Transform a raw content block from JSONL format to our ContentBlock format.
 * Handles snake_case to camelCase conversion for tool_use, tool_result, thinking.
 */
function transformContentBlock(block: unknown): ContentBlock {
  if (!block || typeof block !== 'object') {
    return { type: 'text', text: String(block) };
  }

  const b = block as Record<string, unknown>;

  switch (b.type) {
    case 'tool_use':
      return {
        type: 'tool_use',
        id: String(b.id ?? ''),
        name: String(b.name ?? ''),
        input: (b.input as Record<string, unknown>) ?? {},
      };

    case 'tool_result':
      return {
        type: 'tool_result',
        tool_use_id: String(b.tool_use_id ?? ''),
        content: b.content as string | Record<string, unknown>,
        is_error: Boolean(b.is_error),
      };

    case 'thinking':
      return {
        type: 'thinking',
        thinking: String(b.thinking ?? ''),
        thinkingSignature: b.signature as string | undefined, // signature -> thinkingSignature
        isEncrypted: b.isEncrypted as boolean | undefined,
        encryptedContent: b.encryptedContent as string | undefined,
        summary: b.summary as string | undefined,
      };

    case 'text':
      return {
        type: 'text',
        text: String(b.text ?? ''),
      };

    case 'image':
      return {
        type: 'image',
        source: b.source as { type: 'base64'; media_type: string; data: string },
      };

    default:
      // Unknown block type, wrap as text
      return { type: 'text', text: JSON.stringify(block) };
  }
}

/**
 * Transform content array or string to ContentBlock array.
 */
function transformContent(content: unknown[] | string): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  return content.map(transformContentBlock);
}

// =============================================================================
// Main Transformation Functions
// =============================================================================

/**
 * Result type that includes metadata for batch processing.
 * Used internally to track command/output relationships.
 */
interface TransformResult {
  message: ProcessedMessage;
  isLocalCommand?: boolean;
  isCommandOutput?: boolean;
  commandOutput?: { stdout?: string; stderr?: string };
}

/**
 * Transform a raw JSONL line to ProcessedMessage format.
 * Returns null for non-message lines (summary, file-history-snapshot, meta, etc.)
 */
export function transformRawLine(envelope: RawMessageEnvelope): ProcessedMessage | null {
  const result = transformRawLineInternal(envelope);
  return result?.message ?? null;
}

/**
 * Internal transform that returns additional metadata for batch processing.
 */
function transformRawLineInternal(envelope: RawMessageEnvelope): TransformResult | null {
  const raw = envelope.payload;
  const rawType = (raw as { type?: string })?.type ?? 'unknown';

  // Skip meta lines (caveat messages)
  if (isMetaLine(raw)) {
    debugLog('transform', 'skipped meta line', {
      sessionId: envelope.sessionId,
      uuid: raw.uuid,
    });
    return null;
  }

  // Handle custom-title messages (session rename)
  if (isCustomTitleLine(raw)) {
    // Generate UUID since custom-title doesn't have one
    const generatedId = Crypto.randomUUID();
    const content: ContentBlock[] = [{ type: 'text', text: `Session renamed to: ${raw.customTitle}` }];

    debugLog('transform', 'custom-title → system message', {
      sessionId: envelope.sessionId,
      customTitle: raw.customTitle,
      generatedId,
    });

    return {
      message: {
        id: generatedId,
        session_id: envelope.sessionId,
        parent_id: '',
        type: 'system',
        timestamp: new Date().toISOString(),
        content: JSON.stringify(content),
        stop_reason: '',
        usage: JSON.stringify({}),
        raw_json: JSON.stringify(envelope.payload),
      },
    };
  }

  // Filter: only process user/assistant lines
  if (!isMessageLine(raw)) {
    debugLog('transform', 'filtered non-message type', {
      sessionId: envelope.sessionId,
      rawType,
    });
    return null;
  }

  // Get text content for command detection
  const textContent =
    typeof raw.message.content === 'string'
      ? raw.message.content
      : Array.isArray(raw.message.content)
        ? raw.message.content
            .filter((b): b is { type: 'text'; text: string } => (b as { type?: string })?.type === 'text')
            .map((b) => b.text)
            .join('\n')
        : '';

  // Check if this is a local command message
  const commandInfo = parseLocalCommand(textContent);
  if (commandInfo) {
    debugLog('transform', 'local command detected', {
      sessionId: envelope.sessionId,
      commandName: commandInfo.commandName,
      commandArgs: commandInfo.commandArgs,
    });

    // Create a system message for the command
    return {
      message: {
        id: raw.uuid,
        session_id: envelope.sessionId,
        parent_id: raw.parentUuid ?? '',
        type: 'system',
        subtype: 'local_command',
        timestamp: raw.timestamp,
        content: JSON.stringify([]),
        stop_reason: '',
        usage: JSON.stringify({}),
        raw_json: JSON.stringify(envelope.payload),
        // Store command info in extra fields (will be parsed from raw_json)
        command_name: commandInfo.commandName,
        command_args: commandInfo.commandArgs,
      },
      isLocalCommand: true,
    };
  }

  // Check if this is a command output message
  const outputInfo = parseCommandOutput(textContent);
  if (outputInfo) {
    debugLog('transform', 'command output detected', {
      sessionId: envelope.sessionId,
      hasStdout: !!outputInfo.stdout,
      hasStderr: !!outputInfo.stderr,
    });

    // Return null - this will be merged with the preceding command
    return {
      message: {
        id: raw.uuid,
        session_id: envelope.sessionId,
        parent_id: raw.parentUuid ?? '',
        type: 'user', // Keep original type for now
        timestamp: raw.timestamp,
        content: JSON.stringify([]),
        stop_reason: '',
        usage: JSON.stringify({}),
        raw_json: JSON.stringify(envelope.payload),
      },
      isCommandOutput: true,
      commandOutput: {
        stdout: outputInfo.stdout ? stripAnsi(outputInfo.stdout) : undefined,
        stderr: outputInfo.stderr ? stripAnsi(outputInfo.stderr) : undefined,
      },
    };
  }

  // Transform content blocks
  const content = transformContent(raw.message.content);

  // Transform usage (snake_case to camelCase)
  const usage = raw.message.usage
    ? {
        inputTokens: raw.message.usage.input_tokens,
        outputTokens: raw.message.usage.output_tokens,
      }
    : {};

  // Build ProcessedMessage (ready for SQLite/TinyBase)
  const processed: ProcessedMessage = {
    id: raw.uuid,
    session_id: envelope.sessionId,
    parent_id: raw.parentUuid ?? '',
    type: raw.type,
    timestamp: raw.timestamp,
    content: JSON.stringify(content),
    stop_reason: raw.message.stop_reason ?? '',
    usage: JSON.stringify(usage),
    raw_json: JSON.stringify(envelope.payload),
  };

  debugLog('transform', 'message transformed', {
    id: processed.id,
    sessionId: processed.session_id,
    type: processed.type,
    timestamp: processed.timestamp,
    contentBlocks: content.length,
  });

  return { message: processed };
}

/**
 * Transform a batch of raw envelopes to ProcessedMessages.
 * Filters out non-message lines and groups command + output messages.
 * Uses parentUuid (parent_id) to match outputs with their commands, not position.
 */
export function transformRawBatch(envelopes: RawMessageEnvelope[]): ProcessedMessage[] {
  const { merged } = transformRawBatchWithOutputs(envelopes);
  return merged;
}

/**
 * Result type for batch transformation that includes both merged and output messages.
 */
export interface TransformBatchResult {
  /** Merged messages for TinyBase (commands have stdout/stderr merged) */
  merged: ProcessedMessage[];
  /** Raw output messages to save to SQLite (for reload merging in closed sessions) */
  outputs: ProcessedMessage[];
  /** Output messages whose parent command was NOT in this batch (need late merge to TinyBase) */
  orphanedOutputs: ProcessedMessage[];
}

/**
 * Transform a batch of raw envelopes to ProcessedMessages, returning both merged
 * messages for UI display and raw output messages for SQLite persistence.
 *
 * This is needed because:
 * - UI needs outputs merged into commands for display
 * - SQLite needs output messages as separate rows for reload merging (closed-sessions.ts)
 *
 * Uses parentUuid (parent_id) to match outputs with their commands, not position.
 */
export function transformRawBatchWithOutputs(envelopes: RawMessageEnvelope[]): TransformBatchResult {
  // First pass: transform all envelopes with metadata
  const results = envelopes
    .map(transformRawLineInternal)
    .filter((r): r is TransformResult => r !== null);

  // Build a map of command messages by UUID for output matching
  const commandsByUuid = new Map<string, ProcessedMessage>();
  const merged: ProcessedMessage[] = [];
  const outputs: ProcessedMessage[] = [];
  const orphanedOutputs: ProcessedMessage[] = [];

  // First pass: collect commands and regular messages
  for (const result of results) {
    if (result.isLocalCommand) {
      commandsByUuid.set(result.message.id, result.message);
      merged.push(result.message);
    } else if (result.isCommandOutput) {
      // Collect output messages for SQLite persistence
      // Store stdout/stderr in the output message itself for SQLite
      if (result.commandOutput) {
        result.message.stdout = result.commandOutput.stdout;
        result.message.stderr = result.commandOutput.stderr;
      }
      outputs.push(result.message);
    } else {
      merged.push(result.message);
    }
  }

  // Second pass: merge outputs into commands for UI display
  // Track which outputs are orphaned (parent not in this batch) for late merging
  for (const result of results) {
    if (result.isCommandOutput && result.commandOutput) {
      const parentId = result.message.parent_id;
      const parentCommand = commandsByUuid.get(parentId);
      if (parentCommand) {
        // Append if multiple outputs for the same command
        if (parentCommand.stdout && result.commandOutput.stdout) {
          parentCommand.stdout += '\n' + result.commandOutput.stdout;
        } else if (result.commandOutput.stdout) {
          parentCommand.stdout = result.commandOutput.stdout;
        }

        if (parentCommand.stderr && result.commandOutput.stderr) {
          parentCommand.stderr += '\n' + result.commandOutput.stderr;
        } else if (result.commandOutput.stderr) {
          parentCommand.stderr = result.commandOutput.stderr;
        }
        // Output was merged in-batch, NOT orphaned
      } else {
        // Output without parent command - may arrive in different batch
        // Add to orphanedOutputs for late merging into TinyBase
        orphanedOutputs.push(result.message);
        debugLog('transform', 'orphaned command output - parent not found in batch', {
          parentId,
          sessionId: result.message.session_id,
          hasStdout: !!result.commandOutput.stdout,
          hasStderr: !!result.commandOutput.stderr,
        });
      }
    }
  }

  return { merged, outputs, orphanedOutputs };
}

/**
 * Extract permission requests from a batch of raw envelopes.
 * Returns a Map keyed by sessionId, with the latest permission request for each session.
 */
export function extractPermissionRequests(
  envelopes: RawMessageEnvelope[]
): Map<string, PermissionRequestLine> {
  const requests = new Map<string, PermissionRequestLine>();

  for (const envelope of envelopes) {
    if (isPermissionRequestLine(envelope.payload)) {
      // Store by sessionId - only keep latest per session
      requests.set(envelope.sessionId, envelope.payload);
      debugLog('transform', 'permission request extracted', {
        sessionId: envelope.sessionId,
        toolUseId: envelope.payload.toolUseId,
        toolName: envelope.payload.toolName,
      });
    }
  }

  return requests;
}

/**
 * Extract tool_use_ids that have received tool_results in this batch.
 * Returns a Map keyed by sessionId with Set of tool_use_ids that got results.
 * Used to clear pending permissions when a tool has been resolved.
 */
export function extractResolvedToolUseIds(
  envelopes: RawMessageEnvelope[]
): Map<string, Set<string>> {
  const resolved = new Map<string, Set<string>>();

  for (const envelope of envelopes) {
    if (!isMessageLine(envelope.payload)) continue;

    const raw = envelope.payload as RawMessageLine;
    // Only user messages contain tool_results
    if (raw.type !== 'user') continue;

    const content = raw.message.content;
    if (!Array.isArray(content)) continue;

    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        (block as Record<string, unknown>).type === 'tool_result'
      ) {
        const toolUseId = (block as Record<string, unknown>).tool_use_id as string;
        if (toolUseId) {
          let sessionSet = resolved.get(envelope.sessionId);
          if (!sessionSet) {
            sessionSet = new Set<string>();
            resolved.set(envelope.sessionId, sessionSet);
          }
          sessionSet.add(toolUseId);
        }
      }
    }
  }

  return resolved;
}

// =============================================================================
// Project Extraction (from raw format)
// =============================================================================

/**
 * Extract project info from a raw envelope.
 * Returns null if payload is not a message line or has no cwd.
 * Note: Caller is responsible for generating project ID from path.
 */
export function extractProjectFromRaw(
  envelope: RawMessageEnvelope
): { path: string; data: ProcessedProject } | null {
  const raw = envelope.payload;

  if (!isMessageLine(raw) || !raw.cwd) {
    return null;
  }

  const projectName = raw.cwd.split('/').pop() ?? raw.cwd;

  return {
    path: raw.cwd,
    data: {
      path: raw.cwd,
      name: projectName,
      starred: 0,
    },
  };
}

/**
 * Extract unique projects from a batch of raw envelopes.
 * Returns a Map keyed by path, with ProcessedProject data as values.
 * Caller is responsible for generating hash IDs from the path keys.
 */
export function extractProjectsFromRaw(
  envelopes: RawMessageEnvelope[]
): Map<string, ProcessedProject> {
  const projects = new Map<string, ProcessedProject>();

  for (const envelope of envelopes) {
    const result = extractProjectFromRaw(envelope);
    if (result && !projects.has(result.path)) {
      projects.set(result.path, result.data);
    }
  }

  return projects;
}

// =============================================================================
// Session Metadata Calculation (from raw format)
// =============================================================================

/**
 * Intermediate type for metadata calculation.
 */
interface MessageForMetadata {
  sessionId: string;
  timestamp: string;
  type: 'user' | 'assistant';
  content: ContentBlock[];
}

/**
 * Extract message data needed for metadata calculation.
 */
function extractForMetadata(envelope: RawMessageEnvelope): MessageForMetadata | null {
  const raw = envelope.payload;

  if (!isMessageLine(raw)) {
    return null;
  }

  return {
    sessionId: envelope.sessionId,
    timestamp: raw.timestamp,
    type: raw.type,
    content: transformContent(raw.message.content),
  };
}

/**
 * Calculate session metadata updates from a batch of raw envelopes.
 */
export function calculateSessionMetadataFromRaw(
  envelopes: RawMessageEnvelope[],
  existingCounts: Map<string, number>
): Map<string, SessionMetadataUpdate> {
  const updates = new Map<string, SessionMetadataUpdate>();

  // Extract metadata-relevant info from envelopes
  const messages = envelopes
    .map(extractForMetadata)
    .filter((m): m is MessageForMetadata => m !== null);

  // Group messages by session
  const bySession = new Map<string, MessageForMetadata[]>();
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

// =============================================================================
// Session Name Updates (from custom-title messages)
// =============================================================================

/**
 * Session name update extracted from custom-title message.
 */
export interface SessionNameUpdate {
  sessionId: string;
  name: string;
}

/**
 * Extract session name updates from custom-title messages in a batch.
 * Returns the last custom-title for each session (in case of multiple renames).
 */
export function extractSessionNameUpdates(envelopes: RawMessageEnvelope[]): SessionNameUpdate[] {
  const updates = new Map<string, string>();

  for (const envelope of envelopes) {
    if (isCustomTitleLine(envelope.payload)) {
      // Use envelope.sessionId as the authoritative session ID
      updates.set(envelope.sessionId, envelope.payload.customTitle);
    }
  }

  return Array.from(updates.entries()).map(([sessionId, name]) => ({
    sessionId,
    name,
  }));
}

// =============================================================================
// Batch Result Helpers
// =============================================================================

/**
 * Get last message info from a batch of raw envelopes.
 * Used for cursor tracking.
 */
export function getLastMessageInfo(
  envelopes: RawMessageEnvelope[]
): { lastMessageId: string; lastMessageTs: string } {
  // Filter to message lines only
  const messageEnvelopes = envelopes.filter((e) => isMessageLine(e.payload));

  if (messageEnvelopes.length === 0) {
    return { lastMessageId: '', lastMessageTs: '' };
  }

  // Sort by timestamp
  const sorted = [...messageEnvelopes].sort((a, b) => {
    const aTs = (a.payload as RawMessageLine).timestamp;
    const bTs = (b.payload as RawMessageLine).timestamp;
    return aTs.localeCompare(bTs);
  });

  const last = sorted[sorted.length - 1].payload as RawMessageLine;

  return {
    lastMessageId: last.uuid,
    lastMessageTs: last.timestamp,
  };
}
