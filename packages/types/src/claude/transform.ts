import type {
  ClaudeContentBlock,
  ClaudeUserLine,
  ClaudeAssistantLine,
  ClaudeJsonlLine,
} from "./jsonl";
import type { ContentBlock, MessageRole } from "../index";
import type {
  MessageInsert,
  ToolCallInsert,
  TokenUsageInsert,
} from "../entities";

/**
 * Transform a Claude content block to unified format
 */
export function transformClaudeContentBlock(
  block: ClaudeContentBlock,
): ContentBlock {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };

    case "thinking":
      return {
        type: "thinking",
        thinking: block.thinking,
        thinkingSignature: block.signature,
        isEncrypted: block.isEncrypted,
        encryptedContent: block.encryptedContent,
        summary: block.summary,
      };

    case "tool_use":
      return {
        type: "tool_use",
        id: block.id,
        name: block.name,
        input: block.input,
      };

    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.tool_use_id,
        content: block.content,
        is_error: block.is_error ?? false,
      };

    case "image":
      return {
        type: "image",
        source: {
          type: "base64",
          media_type: block.source.media_type,
          data: block.source.data,
        },
      };
  }
}

/**
 * Transform Claude message content to unified ContentBlock array
 */
export function transformClaudeContent(
  content: ClaudeContentBlock[] | string,
): ContentBlock[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  return content.map(transformClaudeContentBlock);
}

/**
 * Determine unified message role from Claude JSONL line
 */
export function determineMessageRole(line: ClaudeJsonlLine): MessageRole {
  if (line.type === "user") {
    // Check if this is actually a tool result
    if (line.toolUseResult) {
      return "tool";
    }
    // Check content for tool_result blocks
    const content = line.message.content;
    if (Array.isArray(content)) {
      const hasToolResult = content.some(
        (block) => block.type === "tool_result",
      );
      if (hasToolResult) {
        return "tool";
      }
    }
    return "user";
  }
  return "assistant";
}

/**
 * Transform a Claude JSONL user/assistant line to a unified message
 */
export function transformClaudeMessage(
  line: ClaudeUserLine | ClaudeAssistantLine,
  sessionId: string,
): MessageInsert {
  const content = transformClaudeContent(line.message.content);
  const role = determineMessageRole(line);

  return {
    id: line.uuid,
    sessionId,
    parentMessageId: line.parentUuid,
    role,
    providerType: line.type,
    content,
    rawContent:
      typeof line.message.content === "string" ? line.message.content : null,
    model: line.message.model ?? null,
    providerMessageId: line.message.id ?? null,
    providerRequestId:
      line.type === "assistant" ? (line.requestId ?? null) : null,
    providerMetadata: null,
  };
}

/**
 * Extract tool calls from a Claude assistant message
 */
export function extractToolCalls(
  line: ClaudeAssistantLine,
  sessionId: string,
): ToolCallInsert[] {
  const content = line.message.content;
  if (typeof content === "string") {
    return [];
  }

  return content
    .filter(
      (block): block is Extract<ClaudeContentBlock, { type: "tool_use" }> =>
        block.type === "tool_use",
    )
    .map((block) => ({
      id: block.id,
      sessionId,
      messageId: line.uuid,
      resultMessageId: null,
      name: block.name,
      displayName: null,
      description: null,
      input: block.input,
      inputRaw: null,
      output: null,
      resultDisplay: null,
      renderOutputAsMarkdown: null,
      status: "pending" as const,
      errorMessage: null,
      completedAt: null,
      durationMs: null,
      fileEditMetadata: null,
    }));
}

/**
 * Extract token usage from a Claude assistant message
 */
export function extractTokenUsage(
  line: ClaudeAssistantLine,
  sessionId: string,
): TokenUsageInsert | null {
  const usage = line.message.usage;
  if (!usage) {
    return null;
  }

  return {
    id: `${line.uuid}-usage`,
    messageId: line.uuid,
    sessionId,
    model: line.message.model ?? "unknown",
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    totalTokens: usage.input_tokens + usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? null,
    thinkingTokens: null,
    toolTokens: null,
  };
}
