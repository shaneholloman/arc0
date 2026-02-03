import { z } from "zod";

// Artifact type enum
export const artifactTypeSchema = z.enum([
  "plan",
  "todo",
  "thinking",
  "summary",
]);
export type ArtifactType = z.infer<typeof artifactTypeSchema>;

// Artifact status enum
export const artifactStatusSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
]);
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>;

// Artifact schema
export const artifactSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  messageId: z.string().nullable(),

  type: artifactTypeSchema,
  title: z.string(),
  content: z.string().nullable(),

  status: artifactStatusSchema.nullable(),

  timestamp: z.date(),
});

export type Artifact = z.infer<typeof artifactSchema>;

// Insert schema (for creation)
export const artifactInsertSchema = artifactSchema.omit({
  timestamp: true,
});

export type ArtifactInsert = z.infer<typeof artifactInsertSchema>;
