/**
 * Consolidated session status logic.
 * Single source of truth for all status types, computation, colors, and display.
 */

import type { ContentBlock, ToolUseBlock, ToolResultBlock } from '@/lib/types/session';

// =============================================================================
// Types
// =============================================================================

export type SessionStatus =
  | 'sending' // Prompt sent, waiting for ack
  | 'submitting' // Action sent (plan approval, answers, tool approval), waiting for ack
  | 'thinking'
  | 'ask_user'
  | 'plan_approval'
  | 'tool_approval'
  | 'working'
  | 'idle'
  | 'ended'
  | 'error'; // Error state (connection issues, failed requests, etc.)

/**
 * Status metadata for UI rendering.
 */
export interface StatusInfo {
  status: SessionStatus;
  label: string;
  isAnimated: boolean;
}

// =============================================================================
// Tool Display Names
// =============================================================================

/**
 * Human-readable display names for tool operations.
 * Used to generate status labels like "Reading..." or "Running...".
 */
export const TOOL_DISPLAY_NAMES: Record<string, string> = {
  Read: 'Reading',
  Write: 'Writing',
  Edit: 'Editing',
  Glob: 'Finding files',
  Grep: 'Searching',
  Bash: 'Running',
  WebFetch: 'Fetching',
  WebSearch: 'Searching web',
  TodoWrite: 'Updating tasks',
  Task: 'Running task',
  NotebookEdit: 'Editing notebook',
  _default: 'Working',
};

// =============================================================================
// Status Colors & Animation
// =============================================================================

/**
 * Status colors for dots and text.
 * All working states use blue, ask_user uses amber, idle/ended use muted.
 */
export const STATUS_COLORS: Record<SessionStatus, { dot: string; text: string; hex: string }> = {
  sending: { dot: 'bg-blue-500', text: 'text-blue-500', hex: '#3b82f6' },
  submitting: { dot: 'bg-blue-500', text: 'text-blue-500', hex: '#3b82f6' },
  thinking: { dot: 'bg-blue-500', text: 'text-blue-500', hex: '#3b82f6' },
  working: { dot: 'bg-blue-500', text: 'text-blue-500', hex: '#3b82f6' },
  tool_approval: { dot: 'bg-amber-500', text: 'text-amber-500', hex: '#f59e0b' },
  plan_approval: { dot: 'bg-amber-500', text: 'text-amber-500', hex: '#f59e0b' },
  ask_user: { dot: 'bg-amber-500', text: 'text-amber-500', hex: '#f59e0b' },
  idle: { dot: 'bg-muted-foreground', text: 'text-muted-foreground', hex: '#71717a' },
  ended: { dot: 'bg-muted-foreground', text: 'text-muted-foreground', hex: '#71717a' },
  error: { dot: 'bg-red-500', text: 'text-red-500', hex: '#ef4444' },
};

/**
 * Statuses that show an animated loader instead of a static dot.
 * Note: tool_approval, plan_approval, ask_user are NOT animated - they show
 * a static amber dot since they're waiting for user input/response.
 */
export const ANIMATED_STATUSES: SessionStatus[] = ['sending', 'submitting', 'thinking', 'working'];

/**
 * Check if a status should show animation.
 */
export function isAnimatedStatus(status: SessionStatus): boolean {
  return ANIMATED_STATUSES.includes(status);
}

// =============================================================================
// Status Computation
// =============================================================================

/**
 * Input for computing session status.
 */
export interface StatusComputationInput {
  /** Last assistant message data (if any) */
  lastAssistantMsg?: {
    contentBlocks: ContentBlock[];
    stopReason?: string | null;
    timestamp: string;
  };
  /** Last user message data (if any) */
  lastUserMsg?: {
    contentBlocks: ContentBlock[];
    timestamp: string;
  };
  /** Whether the session is open */
  isOpen: boolean;
}

/**
 * Check if content blocks contain a tool_result.
 */
function hasToolResult(blocks: ContentBlock[]): boolean {
  return blocks.some((block) => block.type === 'tool_result');
}

/**
 * Extract tool name from the last tool_use that matches a tool_result.
 * Looks at the assistant message to find the tool_use block that corresponds
 * to a tool_result in the user message.
 */
function extractToolNameFromResult(
  userBlocks: ContentBlock[],
  assistantBlocks?: ContentBlock[]
): string | null {
  // Get tool_use_id from the last tool_result in user message
  const toolResults = userBlocks.filter(
    (block): block is ToolResultBlock => block.type === 'tool_result'
  );
  if (toolResults.length === 0) return null;

  const lastToolResult = toolResults[toolResults.length - 1];
  const toolUseId = lastToolResult.tool_use_id;

  // Find matching tool_use in assistant message
  if (!assistantBlocks) return null;

  const toolUses = assistantBlocks.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  );

  const matchingToolUse = toolUses.find((block) => block.id === toolUseId);
  return matchingToolUse?.name ?? null;
}

/**
 * Generate a working label from a tool name.
 */
function generateWorkingLabel(toolName: string | null): string {
  if (!toolName) return 'Working...';
  const displayName = TOOL_DISPLAY_NAMES[toolName] ?? TOOL_DISPLAY_NAMES._default;
  return `${displayName}...`;
}

/**
 * Check if user message is more recent than assistant message.
 */
function isUserMessageMoreRecent(
  userTimestamp: string | undefined,
  assistantTimestamp: string | undefined
): boolean {
  if (!userTimestamp) return false;
  if (!assistantTimestamp) return true;
  return userTimestamp > assistantTimestamp;
}

/**
 * Compute the session status from the last messages.
 *
 * Detection logic:
 * 1. Session closed → 'ended'
 * 2. No assistant message → 'idle'
 * 3. Has thinking blocks but no text/tools or no stop_reason → 'thinking'
 * 4. Has tool_use with name 'AskUserQuestion' → 'ask_user'
 * 5. Has tool_use with name 'ExitPlanMode' → 'plan_approval'
 * 6. stop_reason === 'tool_use' with any tool → 'tool_approval'
 * 7. User message with tool_result MORE RECENT than assistant → 'working'
 * 8. Default → 'idle'
 */
export function computeSessionStatus(input: StatusComputationInput): StatusInfo {
  const { lastAssistantMsg, lastUserMsg, isOpen } = input;

  // 1. Session is closed
  if (!isOpen) {
    return {
      status: 'ended',
      label: 'Ended',
      isAnimated: false,
    };
  }

  // 2. No assistant message → idle
  if (!lastAssistantMsg) {
    return {
      status: 'idle',
      label: 'Ready',
      isAnimated: false,
    };
  }

  const { contentBlocks, stopReason } = lastAssistantMsg;

  // 3. Check for thinking blocks (Claude is thinking/generating)
  const hasThinking = contentBlocks.some((block) => block.type === 'thinking');
  const hasTextOrTools = contentBlocks.some(
    (block) => block.type === 'text' || block.type === 'tool_use'
  );

  // If only has thinking (no text/tools yet) or no stop_reason → thinking
  if (hasThinking && (!hasTextOrTools || !stopReason)) {
    return {
      status: 'thinking',
      label: 'Thinking...',
      isAnimated: true,
    };
  }

  // Find tool_use blocks
  const toolUseBlocks = contentBlocks.filter(
    (block): block is ToolUseBlock => block.type === 'tool_use'
  );

  // 4. Check for AskUserQuestion
  const askUserTool = toolUseBlocks.find((block) => block.name === 'AskUserQuestion');
  if (askUserTool) {
    return {
      status: 'ask_user',
      label: 'Waiting for answer',
      isAnimated: false,
    };
  }

  // 5. Check for ExitPlanMode
  const exitPlanTool = toolUseBlocks.find((block) => block.name === 'ExitPlanMode');
  if (exitPlanTool) {
    return {
      status: 'plan_approval',
      label: 'Waiting for approval',
      isAnimated: false,
    };
  }

  // 6. Check for other tool use needing approval
  if (stopReason === 'tool_use' && toolUseBlocks.length > 0) {
    return {
      status: 'tool_approval',
      label: 'Approval pending',
      isAnimated: false,
    };
  }

  // 7. User message with tool_result MORE RECENT than assistant → working
  // This means user just approved a tool and it's now executing
  if (
    lastUserMsg &&
    hasToolResult(lastUserMsg.contentBlocks) &&
    isUserMessageMoreRecent(lastUserMsg.timestamp, lastAssistantMsg.timestamp)
  ) {
    const toolName = extractToolNameFromResult(
      lastUserMsg.contentBlocks,
      lastAssistantMsg.contentBlocks
    );
    return {
      status: 'working',
      label: generateWorkingLabel(toolName),
      isAnimated: true,
    };
  }

  // 8. Default: idle (end_turn or no specific state)
  return {
    status: 'idle',
    label: 'Ready',
    isAnimated: false,
  };
}

// =============================================================================
// Aggregate Project Status
// =============================================================================

/**
 * Aggregate status for a project based on its sessions.
 * Used to show a status indicator on collapsed project items.
 */
export type AggregateProjectStatus = 'working' | 'attention' | 'error' | 'idle';

/**
 * Working statuses (blue spinner).
 */
const WORKING_STATUSES: SessionStatus[] = ['sending', 'submitting', 'thinking', 'working'];

/**
 * Attention statuses (yellow dot) - waiting for user input.
 */
const ATTENTION_STATUSES: SessionStatus[] = ['ask_user', 'plan_approval', 'tool_approval'];

/**
 * Compute aggregate project status from session statuses.
 *
 * Priority (highest to lowest):
 * 1. 'attention' - at least one session needs attention (yellow dot) - user action required
 * 2. 'error' - at least one session has error (red dot)
 * 3. 'working' - at least one session is working (blue spinner)
 * 4. 'idle' - all sessions are idle/ended (no indicator)
 */
export function computeAggregateProjectStatus(
  sessionStatuses: SessionStatus[]
): AggregateProjectStatus {
  let hasError = false;
  let hasWorking = false;

  for (const status of sessionStatuses) {
    // Attention takes highest priority - return immediately
    if (ATTENTION_STATUSES.includes(status)) {
      return 'attention';
    }
    if (status === 'error') {
      hasError = true;
    }
    if (WORKING_STATUSES.includes(status)) {
      hasWorking = true;
    }
  }

  // Error takes priority over working
  if (hasError) {
    return 'error';
  }

  if (hasWorking) {
    return 'working';
  }

  return 'idle';
}
