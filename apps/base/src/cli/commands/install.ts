import * as p from "@clack/prompts";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { IS_DEV, CONFIG_DIR } from "../../shared/config.js";
import { isCompiledBinary } from "../../shared/runtime.js";

// Get the directory containing node executable
const NODE_BIN_DIR = dirname(process.execPath);

const LABEL = IS_DEV ? "com.arc0.daemon.dev" : "com.arc0.daemon";
const LAUNCH_AGENTS_DIR = join(homedir(), "Library", "LaunchAgents");
const PLIST_PATH = join(LAUNCH_AGENTS_DIR, `${LABEL}.plist`);

export { LABEL, PLIST_PATH };

/**
 * Check if the LaunchAgent is currently loaded.
 */
export function isLaunchAgentLoaded(): boolean {
  try {
    const output = execSync(`launchctl list | grep ${LABEL}`, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return output.includes(LABEL);
  } catch {
    return false;
  }
}

/**
 * Generate the LaunchAgent plist content.
 */
function generatePlist(): string {
  const env = IS_DEV ? "development" : "production";
  const logFile = join(CONFIG_DIR, "daemon.log");

  let programArgs: string;
  let workingDir: string;

  if (isCompiledBinary()) {
    // For compiled binary: just run the binary with args
    programArgs = `        <string>${process.execPath}</string>
        <string>start</string>
        <string>-f</string>`;
    workingDir = homedir();
  } else {
    // For development: run via tsx with script path
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const cliPath = join(__dirname, "../index.ts");
    const appRoot = join(__dirname, "../../..");
    const tsxPath = join(appRoot, "node_modules/.bin/tsx");
    programArgs = `        <string>${tsxPath}</string>
        <string>${cliPath}</string>
        <string>start</string>
        <string>-f</string>`;
    workingDir = appRoot;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
${programArgs}
    </array>
    <key>EnvironmentVariables</key>
    <dict>
        <key>NODE_ENV</key>
        <string>${env}</string>
        <key>PATH</key>
        <string>${NODE_BIN_DIR}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>StandardOutPath</key>
    <string>${logFile}</string>
    <key>StandardErrorPath</key>
    <string>${logFile}</string>
    <key>WorkingDirectory</key>
    <string>${workingDir}</string>
</dict>
</plist>
`;
}

/**
 * Install the LaunchAgent for auto-start on login.
 */
export async function installCommand(): Promise<void> {
  if (process.platform !== "darwin") {
    p.log.error("Auto-start is only supported on macOS");
    return;
  }

  // Check if already installed and loaded
  if (existsSync(PLIST_PATH) && isLaunchAgentLoaded()) {
    p.log.warn("Already installed - daemon will start on login");
    return;
  }

  // Create LaunchAgents directory if needed
  if (!existsSync(LAUNCH_AGENTS_DIR)) {
    mkdirSync(LAUNCH_AGENTS_DIR, { recursive: true });
  }

  // Write plist file
  const plist = generatePlist();
  writeFileSync(PLIST_PATH, plist);

  // Load the LaunchAgent
  try {
    execSync(`launchctl load ${PLIST_PATH}`, { stdio: "pipe" });
  } catch (err) {
    p.log.error(`Failed to load LaunchAgent: ${err}`);
    return;
  }

  // Start it now
  try {
    execSync(`launchctl start ${LABEL}`, { stdio: "pipe" });
    p.log.success("Installed - daemon running and will auto-start on login");
  } catch {
    p.log.success("Installed - daemon will start on next login");
  }
}
