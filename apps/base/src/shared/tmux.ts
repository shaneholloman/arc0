/**
 * Tmux utilities for interacting with tmux panes.
 */

import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

/**
 * Find a tmux pane by its TTY device.
 * @param tty The TTY device path (e.g., /dev/ttys001)
 * @returns The tmux target string (e.g., "main:0.1") or null if not found
 */
export async function findPaneByTty(tty: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync(
      `tmux list-panes -a -F "#{session_name}:#{window_index}.#{pane_index} #{pane_tty}"`
    );

    for (const line of stdout.trim().split("\n")) {
      if (!line.trim()) continue;
      const parts = line.split(" ");
      if (parts.length >= 2) {
        const target = parts[0];
        const paneTty = parts[1];
        if (paneTty === tty) {
          return target ?? null;
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Send text to a tmux pane.
 * @param target The tmux target (e.g., "main:0.1")
 * @param message The message to send
 * @param pressEnter Whether to press Enter after the message (default: true)
 */
export async function sendToPane(
  target: string,
  message: string,
  pressEnter: boolean = true
): Promise<boolean> {
  try {
    // Send the message text literally
    await execAsync(`tmux send-keys -t ${target} -l ${JSON.stringify(message)}`);

    if (pressEnter) {
      await execAsync(`tmux send-keys -t ${target} Enter`);
    }

    return true;
  } catch (error) {
    console.error("[tmux] Failed to send to pane:", error);
    return false;
  }
}

/**
 * Send a special key to a tmux pane.
 * @param target The tmux target (e.g., "main:0.1")
 * @param key The key to send (e.g., "Escape", "Enter")
 */
export async function sendKeyToPane(target: string, key: string): Promise<boolean> {
  try {
    await execAsync(`tmux send-keys -t ${target} ${key}`);
    return true;
  } catch (error) {
    console.error("[tmux] Failed to send key to pane:", error);
    return false;
  }
}

// =============================================================================
// Session/Window Creation (for mobile-initiated sessions)
// =============================================================================

const ARC0_SESSION_NAME = "arc0";

/**
 * Shell-escape a string for use in tmux commands.
 * Uses single quotes and escapes any single quotes within.
 */
function shellEscape(str: string): string {
  // Wrap in single quotes and escape any single quotes inside
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/**
 * Check if tmux is installed on the system.
 * @returns true if tmux binary is found in PATH
 */
export async function isTmuxInstalled(): Promise<boolean> {
  try {
    await execAsync("which tmux");
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a tmux session exists.
 * @param sessionName The session name to check
 * @returns true if the session exists
 */
async function sessionExists(sessionName: string): Promise<boolean> {
  try {
    await execAsync(`tmux has-session -t ${sessionName} 2>/dev/null`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Ensure the arc0 tmux session exists.
 * Creates it if it doesn't exist.
 * @returns The session name ("arc0") or null if failed
 */
export async function ensureArc0Session(): Promise<string | null> {
  try {
    if (await sessionExists(ARC0_SESSION_NAME)) {
      return ARC0_SESSION_NAME;
    }

    // Create a new detached session
    await execAsync(`tmux new-session -d -s ${ARC0_SESSION_NAME}`);
    return ARC0_SESSION_NAME;
  } catch (error) {
    console.error("[tmux] Failed to ensure arc0 session:", error);
    return null;
  }
}

/**
 * Create a new window in the arc0 tmux session.
 * @param windowName Optional name for the window
 * @param cwd Working directory for the window
 * @returns The target string (e.g., "arc0:1") or null if failed
 */
export async function createWindow(
  windowName: string | undefined,
  cwd: string
): Promise<string | null> {
  try {
    // Build the command with proper shell escaping
    let cmd = `tmux new-window -t ${ARC0_SESSION_NAME} -P -F "#{session_name}:#{window_index}"`;

    if (windowName) {
      cmd += ` -n ${shellEscape(windowName)}`;
    }

    cmd += ` -c ${shellEscape(cwd)}`;

    const { stdout } = await execAsync(cmd);
    const target = stdout.trim();

    if (!target) {
      console.error("[tmux] createWindow returned empty target");
      return null;
    }

    return target;
  } catch (error) {
    console.error("[tmux] Failed to create window:", error);
    return null;
  }
}

/**
 * Run a command in a tmux pane.
 * @param target The tmux target (e.g., "arc0:1")
 * @param command The command to run
 * @returns true if successful
 */
export async function runInPane(target: string, command: string): Promise<boolean> {
  try {
    // Send the command literally (-l flag) and press Enter
    await execAsync(`tmux send-keys -t ${target} -l ${JSON.stringify(command)}`);
    await execAsync(`tmux send-keys -t ${target} Enter`);
    return true;
  } catch (error) {
    console.error("[tmux] Failed to run command in pane:", error);
    return false;
  }
}

