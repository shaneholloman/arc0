import { z } from "zod";

// AI Provider ID
export const providerIdSchema = z.enum(["claude", "codex", "gemini"]);
export type ProviderId = z.infer<typeof providerIdSchema>;

// Provider configuration format
export const configFormatSchema = z.enum(["json", "toml"]);
export type ConfigFormat = z.infer<typeof configFormatSchema>;

// Provider authentication method
export const authMethodSchema = z.enum(["api-key", "oauth"]);
export type AuthMethod = z.infer<typeof authMethodSchema>;

// Message role in conversation
export const messageRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);
export type MessageRole = z.infer<typeof messageRoleSchema>;

// Content block type within a message
export const contentBlockTypeSchema = z.enum([
  "text",
  "thinking",
  "tool_use",
  "tool_result",
  "image",
  "file",
]);
export type ContentBlockType = z.infer<typeof contentBlockTypeSchema>;

// Tool call execution status
export const toolCallStatusSchema = z.enum([
  "pending",
  "success",
  "error",
  "cancelled",
]);
export type ToolCallStatus = z.infer<typeof toolCallStatusSchema>;

// File operation type
export const fileOperationSchema = z.enum(["create", "read", "edit", "delete"]);
export type FileOperation = z.infer<typeof fileOperationSchema>;

// Rate limit window type (Codex-specific)
export const rateLimitWindowSchema = z.enum(["primary", "secondary"]);
export type RateLimitWindow = z.infer<typeof rateLimitWindowSchema>;

// System event type
export const systemEventTypeSchema = z.enum([
  "info",
  "warning",
  "error",
  "update_available",
]);
export type SystemEventType = z.infer<typeof systemEventTypeSchema>;
