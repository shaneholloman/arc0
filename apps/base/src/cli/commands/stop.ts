import * as p from "@clack/prompts";
import { isDaemonLocked } from "../../shared/lock.js";
import { readDaemonState, removeDaemonState } from "../../shared/pid.js";

export async function stopCommand(): Promise<void> {
  if (!(await isDaemonLocked())) {
    p.log.info("Daemon is not running");
    return;
  }

  const state = readDaemonState();
  if (!state?.pid) {
    p.log.error("Could not read daemon PID");
    return;
  }

  const s = p.spinner();
  s.start("Stopping daemon...");

  try {
    process.kill(state.pid, "SIGTERM");

    // Wait for lock to be released (daemon exited)
    let attempts = 0;
    while ((await isDaemonLocked()) && attempts < 10) {
      await new Promise((r) => setTimeout(r, 200));
      attempts++;
    }

    if (await isDaemonLocked()) {
      // Force kill if still running
      process.kill(state.pid, "SIGKILL");
      removeDaemonState();
    }

    s.stop("Daemon stopped");
  } catch (err: unknown) {
    // ESRCH means process is already dead - treat as success
    if (err && typeof err === "object" && "code" in err && err.code === "ESRCH") {
      removeDaemonState();
      s.stop("Daemon stopped (process was already dead)");
    } else {
      s.stop("Failed to stop daemon");
      p.log.error(`Error: ${err}`);
      removeDaemonState();
    }
  }
}
