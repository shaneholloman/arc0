// =============================================================================
// Raw Claude line type guards (minimal; do not over-validate)
// =============================================================================

interface RawMessageLine {
  type: "user" | "assistant";
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  message: {
    content: unknown[] | string;
    usage?: { input_tokens: number; output_tokens: number };
    stop_reason?: unknown;
    model?: string;
  };
  // Claude sometimes puts tool results here instead of message.content tool_result blocks.
  toolUseResult?: {
    toolCallId: string;
    toolName: string;
    result: unknown;
  };
}

export function isMessageLine(payload: unknown): payload is RawMessageLine {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    (p.type === "user" || p.type === "assistant") &&
    typeof p.uuid === "string" &&
    typeof p.timestamp === "string" &&
    typeof p.message === "object" &&
    p.message !== null
  );
}

interface RawSystemLocalCommandLine {
  type: "system";
  subtype: "local_command";
  uuid: string;
  parentUuid: string | null;
  timestamp: string;
  content: string;
}

export function isSystemLocalCommandLine(
  payload: unknown,
): payload is RawSystemLocalCommandLine {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return (
    p.type === "system" &&
    p.subtype === "local_command" &&
    typeof p.uuid === "string" &&
    typeof p.timestamp === "string" &&
    typeof p.content === "string"
  );
}

export function isMetaLine(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  return (payload as { isMeta?: unknown }).isMeta === true;
}

interface RawCustomTitleLine {
  type: "custom-title";
  customTitle: string;
}

export function isCustomTitleLine(
  payload: unknown,
): payload is RawCustomTitleLine {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  return p.type === "custom-title" && typeof p.customTitle === "string";
}
