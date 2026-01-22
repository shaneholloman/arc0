import * as p from "@clack/prompts";
import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { isDaemonLocked } from "../../shared/lock.js";
import { readDaemonState } from "../../shared/pid.js";
import { LOG_FILE } from "../../shared/config.js";
import { isCompiledBinary } from "../../shared/runtime.js";

export async function startCommand(foreground = false): Promise<void> {
  if (await isDaemonLocked()) {
    const state = readDaemonState();
    p.log.warn(`Daemon is already running (PID: ${state?.pid}, control: ${state?.controlPort}, socket: ${state?.socketPort})`);
    return;
  }

  if (foreground) {
    p.log.info("Starting daemon in foreground mode...");
    // Import and run daemon directly
    await import("../../daemon/index.js");
    return;
  }

  const s = p.spinner();
  s.start("Starting daemon...");

  // Open log file for daemon output
  const logFd = openSync(LOG_FILE, "a");

  let child;
  if (isCompiledBinary()) {
    // Compiled binary: spawn self with args
    child = spawn(process.execPath, ["start", "--foreground"], {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV ?? "production" },
    });
  } else {
    // Dev mode: spawn via tsx
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

  // Wait briefly and check if it started
  await new Promise((r) => setTimeout(r, 1000));

  if (await isDaemonLocked()) {
    const state = readDaemonState();
    s.stop(`Daemon started (PID: ${state?.pid}, control: ${state?.controlPort}, socket: ${state?.socketPort})`);
  } else {
    s.stop("Failed to start daemon");
    p.log.error(`Check ${LOG_FILE} for details`);
  }
}
