/**
 * Session launcher for mobile-initiated sessions.
 * Creates tmux windows and runs provider CLIs.
 */

import type { ActionResult, OpenSessionPayload, ProviderId } from "@arc0/types";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import {
  isTmuxInstalled,
  ensureArc0Session,
  createWindow,
  runInPane,
} from "../shared/tmux.js";

const execAsync = promisify(exec);

/**
 * Check if a directory exists.
 */
async function directoryExists(path: string): Promise<boolean> {
  try {
    const stats = await stat(path);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Provider CLI commands
const PROVIDER_COMMANDS: Record<ProviderId, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
};

/**
 * Check if a provider CLI is available in PATH.
 */
async function isProviderInstalled(provider: ProviderId): Promise<boolean> {
  const command = PROVIDER_COMMANDS[provider];
  try {
    await execAsync(`which ${command}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Launch a new session in tmux.
 * @param payload The open session payload from mobile
 * @returns ActionResult indicating success or error
 */
export async function launchSession(
  payload: OpenSessionPayload
): Promise<ActionResult> {
  const { provider, name, cwd } = payload;

  console.log(`[session-launcher] Launching session: provider=${provider} name=${name ?? "unnamed"} cwd=${cwd}`);

  // 1. Validate cwd
  if (!cwd || cwd.trim() === "") {
    return {
      status: "error",
      code: "INVALID_CWD",
      message: "Working directory (cwd) is required.",
    };
  }

  if (!(await directoryExists(cwd))) {
    return {
      status: "error",
      code: "INVALID_CWD",
      message: `Working directory does not exist: ${cwd}`,
    };
  }

  // 2. Check tmux is installed
  if (!(await isTmuxInstalled())) {
    return {
      status: "error",
      code: "TMUX_NOT_INSTALLED",
      message: "tmux is not installed. Install tmux to create sessions from mobile.",
    };
  }

  // 3. Check provider CLI is installed
  if (!(await isProviderInstalled(provider))) {
    return {
      status: "error",
      code: "PROVIDER_NOT_FOUND",
      message: `Provider CLI '${PROVIDER_COMMANDS[provider]}' not found in PATH.`,
    };
  }

  // 4. Ensure arc0 tmux session exists
  const sessionName = await ensureArc0Session();
  if (!sessionName) {
    return {
      status: "error",
      code: "SESSION_CREATE_FAILED",
      message: "Failed to create arc0 tmux session.",
    };
  }

  // 5. Create new window in the session
  const target = await createWindow(name, cwd);
  if (!target) {
    return {
      status: "error",
      code: "SESSION_CREATE_FAILED",
      message: "Failed to create tmux window.",
    };
  }

  console.log(`[session-launcher] Created tmux window: ${target}`);

  // 6. Run provider CLI in the pane
  const providerCommand = PROVIDER_COMMANDS[provider];
  const success = await runInPane(target, providerCommand);

  if (!success) {
    return {
      status: "error",
      code: "SESSION_CREATE_FAILED",
      message: "Failed to launch provider CLI in tmux pane.",
    };
  }

  console.log(`[session-launcher] Launched ${providerCommand} in ${target}`);

  // 7. Success - the provider's hook will create the session file
  // which will be detected by SessionFileWatcher and broadcast to mobile
  return {
    status: "success",
    message: `Session started in tmux window '${name ?? target}'`,
  };
}
