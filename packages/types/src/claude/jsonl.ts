import { z } from "zod";

// Claude raw content block schemas (JSONL format)

export const claudeTextBlockSchema = z.object({
  type: z.literal("text"),
  text: z.string(),
});

export const claudeThinkingBlockSchema = z.object({
  type: z.literal("thinking"),
  thinking: z.string(),
  signature: z.string().optional(), // Note: "signature" not "thinkingSignature"
  isEncrypted: z.boolean().optional(),
  encryptedContent: z.string().optional(),
  summary: z.string().optional(),
});

export const claudeToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(), // Note: "id" not "toolCallId"
  name: z.string(),
  input: z.record(z.string(), z.unknown()),
});

export const claudeToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(), // Note: "tool_use_id" not "toolCallId"
  content: z.union([z.string(), z.record(z.string(), z.unknown())]),
  is_error: z.boolean().optional(),
});

export const claudeImageBlockSchema = z.object({
  type: z.literal("image"),
  source: z.object({
    type: z.literal("base64"),
    media_type: z.string(),
    data: z.string(),
  }),
});

export const claudeContentBlockSchema = z.discriminatedUnion("type", [
  claudeTextBlockSchema,
  claudeThinkingBlockSchema,
  claudeToolUseBlockSchema,
  claudeToolResultBlockSchema,
  claudeImageBlockSchema,
]);

export type ClaudeContentBlock = z.infer<typeof claudeContentBlockSchema>;

// Claude message schema (inside JSONL line)
export const claudeMessageSchema = z.object({
  id: z.string().optional(),
  role: z.enum(["user", "assistant"]),
  content: z.array(claudeContentBlockSchema).or(z.string()),
  model: z.string().optional(),
  usage: z
    .object({
      input_tokens: z.number(),
      output_tokens: z.number(),
      cache_read_input_tokens: z.number().optional(),
      cache_creation_input_tokens: z.number().optional(),
    })
    .optional(),
});

export type ClaudeMessage = z.infer<typeof claudeMessageSchema>;

// Claude JSONL line types
export const claudeUserLineSchema = z.object({
  type: z.literal("user"),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  message: claudeMessageSchema,
  timestamp: z.string(),
  toolUseResult: z
    .object({
      toolCallId: z.string(),
      toolName: z.string(),
      result: z.unknown(),
      metadata: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

export const claudeAssistantLineSchema = z.object({
  type: z.literal("assistant"),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  message: claudeMessageSchema,
  timestamp: z.string(),
  requestId: z.string().optional(),
  costUSD: z.number().optional(),
});

export const claudeFileHistorySnapshotLineSchema = z.object({
  type: z.literal("file-history-snapshot"),
  uuid: z.string(),
  parentUuid: z.string().nullable(),
  timestamp: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      content: z.string().optional(),
      hash: z.string().optional(),
    }),
  ),
});

export const claudeSessionInfoLineSchema = z.object({
  type: z.literal("session-info"),
  uuid: z.string(),
  sessionId: z.string(),
  version: z.string(),
  cwd: z.string(),
  gitBranch: z.string().optional(),
  gitCommit: z.string().optional(),
  slug: z.string().optional(),
  userType: z.string().optional(),
  isSidechain: z.boolean().optional(),
});

export const claudeSummaryLineSchema = z.object({
  type: z.literal("summary"),
  summary: z.string(),
  leafUuid: z.string(),
});

// Union of all JSONL line types
export const claudeJsonlLineSchema = z.discriminatedUnion("type", [
  claudeUserLineSchema,
  claudeAssistantLineSchema,
  claudeFileHistorySnapshotLineSchema,
  claudeSessionInfoLineSchema,
  claudeSummaryLineSchema,
]);

export type ClaudeJsonlLine = z.infer<typeof claudeJsonlLineSchema>;
export type ClaudeUserLine = z.infer<typeof claudeUserLineSchema>;
export type ClaudeAssistantLine = z.infer<typeof claudeAssistantLineSchema>;
