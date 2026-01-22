import * as p from "@clack/prompts";
import { existsSync, unlinkSync } from "node:fs";
import { execSync } from "node:child_process";
import { LABEL, PLIST_PATH, isLaunchAgentLoaded } from "./install.js";

/**
 * Uninstall the LaunchAgent (disable auto-start).
 */
export async function uninstallCommand(): Promise<void> {
  if (process.platform !== "darwin") {
    p.log.error("Auto-start is only supported on macOS");
    return;
  }

  if (!existsSync(PLIST_PATH)) {
    p.log.warn("Not installed");
    return;
  }

  // Stop and unload if running
  if (isLaunchAgentLoaded()) {
    try {
      execSync(`launchctl stop ${LABEL}`, { stdio: "pipe" });
    } catch {
      // Ignore - might not be running
    }

    try {
      execSync(`launchctl unload ${PLIST_PATH}`, { stdio: "pipe" });
    } catch (err) {
      p.log.error(`Failed to unload: ${err}`);
    }
  }

  // Remove plist file
  try {
    unlinkSync(PLIST_PATH);
    p.log.success("Uninstalled - daemon will not auto-start");
  } catch (err) {
    p.log.error(`Failed to remove plist: ${err}`);
  }
}
