import type {
  Message,
  ToolResultBlock,
  ToolUseBlock,
  ToolUseResultMetadata,
} from '@/lib/types/session';

export interface ToolResultWithMetadata {
  block: ToolResultBlock;
  metadata?: ToolUseResultMetadata;
}

export interface PendingToolUse {
  block: ToolUseBlock;
  message: Message;
  messageIndex: number;
}

export interface ToolStateSummary {
  toolResults: Map<string, ToolResultWithMetadata>;
  pendingToolUses: PendingToolUse[];
}

const NON_INTERACTIVE_TOOLS = new Set(['TodoWrite', 'EnterPlanMode']);

export function isNonInteractiveTool(toolName: string): boolean {
  return NON_INTERACTIVE_TOOLS.has(toolName);
}

export function deriveToolState(messages: Message[]): ToolStateSummary {
  const toolResults = new Map<string, ToolResultWithMetadata>();

  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_result') {
        toolResults.set(block.tool_use_id, {
          block,
          metadata: message.toolUseResult,
        });
      }
    }
  }

  const pendingToolUses: PendingToolUse[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.type !== 'assistant') return;
    for (const block of message.content) {
      if (block.type === 'tool_use' && !toolResults.has(block.id)) {
        pendingToolUses.push({ block, message, messageIndex });
      }
    }
  });

  return { toolResults, pendingToolUses };
}

export function findLatestPendingTool(messages: Message[]): PendingToolUse | null {
  const { pendingToolUses } = deriveToolState(messages);
  if (pendingToolUses.length === 0) return null;
  return pendingToolUses[pendingToolUses.length - 1];
}

export function isToolResultRejected(result: ToolResultBlock | undefined): boolean {
  return Boolean(result?.is_error);
}
