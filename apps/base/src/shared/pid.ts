import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { PID_FILE, STATE_FILE, CONFIG_DIR, type DaemonState } from "./config.js";

export function writePid(pid: number): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(PID_FILE, String(pid), "utf-8");
}

export function readPid(): number | null {
  try {
    const content = readFileSync(PID_FILE, "utf-8").trim();
    return parseInt(content, 10);
  } catch {
    return null;
  }
}

export function removePid(): void {
  try {
    unlinkSync(PID_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

export function writeDaemonState(state: DaemonState): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
}

export function readDaemonState(): DaemonState | null {
  try {
    const content = readFileSync(STATE_FILE, "utf-8");
    return JSON.parse(content) as DaemonState;
  } catch {
    return null;
  }
}

export function removeDaemonState(): void {
  try {
    unlinkSync(STATE_FILE);
  } catch {
    // Ignore if file doesn't exist
  }
}

export function isDaemonRunning(): boolean {
  const state = readDaemonState();
  const pid = state?.pid ?? readPid();
  if (!pid) return false;

  try {
    // Sending signal 0 checks if process exists without killing it
    process.kill(pid, 0);
    return true;
  } catch {
    // Process doesn't exist, clean up stale files
    removePid();
    removeDaemonState();
    return false;
  }
}
