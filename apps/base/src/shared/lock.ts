import lockfile from "proper-lockfile";
import { existsSync, writeFileSync, mkdirSync } from "node:fs";
import { CONFIG_DIR, STATE_FILE } from "./config.js";

/**
 * Ensure the state file exists (lockfile needs a file to lock)
 */
function ensureStateFile(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(STATE_FILE)) {
    writeFileSync(STATE_FILE, "{}", "utf-8");
  }
}

/**
 * Try to acquire the daemon lock.
 * Returns a release function if successful, null if already locked.
 */
export async function acquireDaemonLock(): Promise<
  (() => Promise<void>) | null
> {
  ensureStateFile();

  try {
    const release = await lockfile.lock(STATE_FILE, {
      stale: 10000, // Consider lock stale after 10s without update
      update: 5000, // Update lock every 5s to prevent stale
    });
    return release;
  } catch (err: unknown) {
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      err.code === "ELOCKED"
    ) {
      return null; // Already locked by another process
    }
    throw err; // Unexpected error
  }
}

/**
 * Check if the daemon lock is held by another process.
 */
export async function isDaemonLocked(): Promise<boolean> {
  ensureStateFile();

  try {
    return await lockfile.check(STATE_FILE, {
      stale: 10000,
    });
  } catch {
    return false;
  }
}
