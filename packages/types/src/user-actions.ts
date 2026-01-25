/**
 * User action types for Mobile -> Base communication.
 * Actions use separate Socket.IO events with ack callbacks.
 */

import { z } from "zod";
import { providerIdSchema } from "./enums";

// =============================================================================
// Enums
// =============================================================================

export const modelIdSchema = z.enum(["default", "opus-4.5", "sonnet-4.5", "haiku-4.5"]);
export type ModelId = z.infer<typeof modelIdSchema>;

export const promptModeSchema = z.enum(["default", "bypass", "ask", "plan"]);
export type PromptMode = z.infer<typeof promptModeSchema>;

/**
 * Plan approval options (matching Claude CLI):
 * 1 = Yes, clear context and bypass permissions
 * 2 = Yes, and bypass permissions
 * 3 = Yes, manually approve edits
 * 4 = Feedback (requires text)
 */
export const planApprovalOptionSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type PlanApprovalOption = z.infer<typeof planApprovalOptionSchema>;

/**
 * Tool approval options:
 * 1 = Approve once (allow this specific tool call)
 * 2 = Approve always (allow this tool for the session)
 * 3 = Reject (deny this tool call)
 */
export const toolApprovalOptionSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type ToolApprovalOption = z.infer<typeof toolApprovalOptionSchema>;

/**
 * Individual answer to a question.
 */
export const answerItemSchema = z.object({
  questionIndex: z.number(),
  option: z.number(),
  text: z.string().optional(),
});
export type AnswerItem = z.infer<typeof answerItemSchema>;

// =============================================================================
// Tool Response Types (discriminated union for unified approveToolUse)
// =============================================================================

/**
 * Response for regular tools (Bash, Edit, Write, Read, etc.)
 */
export const toolResponseToolSchema = z.object({
  type: z.literal("tool"),
  option: toolApprovalOptionSchema, // 1, 2, or 3
});

/**
 * Response for ExitPlanMode (plan approval)
 */
export const toolResponsePlanSchema = z.object({
  type: z.literal("plan"),
  option: planApprovalOptionSchema, // 1, 2, 3, or 4
  text: z.string().optional(), // Required when option is 4
});

/**
 * Response for AskUserQuestion
 */
export const toolResponseAnswersSchema = z.object({
  type: z.literal("answers"),
  answers: z.array(answerItemSchema),
});

/**
 * Discriminated union for all tool response types.
 * Used in the unified approveToolUse action.
 */
export const toolResponseSchema = z.discriminatedUnion("type", [
  toolResponseToolSchema,
  toolResponsePlanSchema,
  toolResponseAnswersSchema,
]);
export type ToolResponse = z.infer<typeof toolResponseSchema>;

// =============================================================================
// Base Payload (common fields)
// =============================================================================

export const baseActionPayloadSchema = z.object({
  id: z.string().uuid(),
  initiatedAt: z.number(),
});
export type BaseActionPayload = z.infer<typeof baseActionPayloadSchema>;

// =============================================================================
// Individual Action Payloads
// =============================================================================

/**
 * Payload for opening a new session.
 */
export const openSessionPayloadSchema = baseActionPayloadSchema.extend({
  provider: providerIdSchema,
  name: z.string().optional(),
  cwd: z.string(), // Required: working directory for the session
});
export type OpenSessionPayload = z.infer<typeof openSessionPayloadSchema>;

/**
 * Payload for sending a prompt to a session.
 */
export const sendPromptPayloadSchema = baseActionPayloadSchema.extend({
  sessionId: z.string(),
  text: z.string(),
  model: modelIdSchema,
  mode: promptModeSchema,
  lastMessageId: z.string().optional(),
  lastMessageTs: z.number().optional(),
  // TODO: attachments
});
export type SendPromptPayload = z.infer<typeof sendPromptPayloadSchema>;

/**
 * Payload for stopping the agent.
 */
export const stopAgentPayloadSchema = baseActionPayloadSchema.extend({
  sessionId: z.string(),
  lastMessageId: z.string().optional(),
  lastMessageTs: z.number().optional(),
});
export type StopAgentPayload = z.infer<typeof stopAgentPayloadSchema>;

/**
 * Unified payload for all tool responses (permission, plan approval, answers).
 * Uses discriminated union via the `response` field.
 */
export const approveToolUsePayloadSchema = baseActionPayloadSchema.extend({
  sessionId: z.string(),
  toolUseId: z.string(),
  toolName: z.string(),
  response: toolResponseSchema,
  lastMessageId: z.string().optional(),
  lastMessageTs: z.number().optional(),
});
export type ApproveToolUsePayload = z.infer<typeof approveToolUsePayloadSchema>;

// =============================================================================
// Response Types
// =============================================================================

/**
 * Result returned via ack callback.
 */
export const actionResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("success"),
    sessionId: z.string().optional(),
    message: z.string().optional(),
  }),
  z.object({
    status: z.literal("error"),
    code: z.string(),
    message: z.string(),
  }),
]);
export type ActionResult = z.infer<typeof actionResultSchema>;

// =============================================================================
// Action Event Names
// =============================================================================

export const USER_ACTION_EVENTS = {
  OPEN_SESSION: "openSession",
  SEND_PROMPT: "sendPrompt",
  STOP_AGENT: "stopAgent",
  APPROVE_TOOL_USE: "approveToolUse",
} as const;

export type UserActionEvent = (typeof USER_ACTION_EVENTS)[keyof typeof USER_ACTION_EVENTS];
