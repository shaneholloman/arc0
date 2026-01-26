import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDaemonLocked } from "../../shared/lock.js";
import { readDaemonState, removeDaemonState } from "../../shared/pid.js";
import { LOG_FILE } from "../../shared/config.js";
import { isCompiledBinary } from "../../shared/runtime.js";

export async function restartCommand(): Promise<void> {
  const wasRunning = await isDaemonLocked();

  // === STOP PHASE (mirrors stop.ts) ===
  if (wasRunning) {
    const state = readDaemonState();
    if (!state?.pid) {
      p.log.error("Could not read daemon PID");
      return;
    }

    const s = p.spinner();
    s.start("Stopping daemon...");

    try {
      process.kill(state.pid, "SIGTERM");

      // Wait for lock to be released (daemon exited) - same as stop.ts: 2 seconds
      let attempts = 0;
      while ((await isDaemonLocked()) && attempts < 10) {
        await new Promise((r) => setTimeout(r, 200));
        attempts++;
      }

      if (await isDaemonLocked()) {
        // Force kill if still running - same as stop.ts
        process.kill(state.pid, "SIGKILL");
        removeDaemonState();

        // Wait for lock to actually release after SIGKILL
        let lockAttempts = 0;
        while ((await isDaemonLocked()) && lockAttempts < 50) {
          await new Promise((r) => setTimeout(r, 200));
          lockAttempts++;
        }
      }

      s.stop("Daemon stopped");
    } catch (err: unknown) {
      // ESRCH means process is already dead - treat as "already stopped"
      if (err && typeof err === "object" && "code" in err && err.code === "ESRCH") {
        removeDaemonState();

        // Wait for lock to release (stale lock may persist up to 10s)
        let lockAttempts = 0;
        while ((await isDaemonLocked()) && lockAttempts < 50) {
          await new Promise((r) => setTimeout(r, 200));
          lockAttempts++;
        }

        s.stop("Daemon stopped (process was already dead)");
      } else {
        s.stop("Failed to stop daemon");
        p.log.error(`Error: ${err}`);
        removeDaemonState();
        return;
      }
    }
  } else {
    p.log.info("Daemon was not running");
  }

  // === START PHASE (mirrors start.ts) ===
  const s = p.spinner();
  s.start("Starting daemon...");

  const logFd = openSync(LOG_FILE, "a");

  let child;
  if (isCompiledBinary()) {
    child = spawn(process.execPath, ["start", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
    });
  } else {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const cliPath = join(__dirname, "../index.ts");
    const appRoot = join(__dirname, "../../..");
    const tsxPath = join(appRoot, "node_modules/.bin/tsx");

    child = spawn(tsxPath, [cliPath, "start", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "development" },
    });
  }

  child.unref();

  // Wait briefly and check if it started - same as start.ts
  await new Promise((r) => setTimeout(r, 1000));

  if (await isDaemonLocked()) {
    const newState = readDaemonState();
    s.stop(`Daemon started (PID: ${newState?.pid}, control: ${newState?.controlPort}, socket: ${newState?.socketPort})`);
  } else {
    s.stop("Failed to start daemon");
    p.log.error(`Check ${LOG_FILE} for details`);
  }
}
