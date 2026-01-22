import * as p from "@clack/prompts";
import pc from "picocolors";
import { VERSION, loadConfig, type Arc0Config } from "../shared/config.js";
import { startCommand } from "./commands/start.js";
import { stopCommand } from "./commands/stop.js";
import { statusCommand } from "./commands/status.js";
import { initCommand } from "./commands/init.js";
import { authCommand } from "./commands/auth.js";
import { hooksCommand } from "./commands/hooks.js";
import { tunnelCommand } from "./commands/tunnel.js";
import { installCommand } from "./commands/install.js";
import { uninstallCommand } from "./commands/uninstall.js";

// ============================================
// ASCII ART - Replace this string with your own
// ============================================
const ASCII_ART = `
 █████╗                    ██████╗
██╔══██╗                  ██╔═████╗
███████║ ██████╗  ██████╗ ██║██╔██║
██╔══██║ ██╔═══╝ ██╔════╝ ████╔╝██║
██║  ██║ ██║     ╚██████╗ ╚██████╔╝
╚═╝  ╚═╝ ╚═╝      ╚═════╝  ╚═════╝
`;

// Bright gradient colors using ANSI 256 colors
// Goes: green → yellow → orange → red → magenta → purple → blue → cyan
const GRADIENT_COLORS = [
  "\x1b[38;5;46m", // bright green
  "\x1b[38;5;118m", // lime
  "\x1b[38;5;154m", // yellow-green
  "\x1b[38;5;226m", // yellow
  "\x1b[38;5;214m", // orange
  "\x1b[38;5;208m", // dark orange
  "\x1b[38;5;196m", // red
  "\x1b[38;5;199m", // pink
  "\x1b[38;5;201m", // magenta
  "\x1b[38;5;165m", // purple
  "\x1b[38;5;129m", // violet
  "\x1b[38;5;93m", // blue-violet
  "\x1b[38;5;63m", // blue
  "\x1b[38;5;33m", // bright blue
  "\x1b[38;5;39m", // cyan
  "\x1b[38;5;49m", // cyan-green
];
const RESET = "\x1b[0m";

function printRainbowArt(): void {
  const lines = ASCII_ART.split("\n").filter((line) => line.length > 0);
  const maxLen = Math.max(...lines.map((l) => l.length));

  for (const line of lines) {
    let coloredLine = "";
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === " ") {
        coloredLine += char;
      } else {
        // Map position to gradient color
        const colorIndex = Math.floor(
          (i / maxLen) * (GRADIENT_COLORS.length - 1),
        );
        coloredLine += (GRADIENT_COLORS[colorIndex] ?? "") + (char ?? "") + RESET;
      }
    }
    console.log(coloredLine);
  }
  console.log();
  console.log(
    "Mobile app to command the coding agents running on your workstation",
  );
  console.log();
}

const HELP = `
${pc.bold("Arc0")} - Workstation client tp sync your coding sessons with Arc0 apps

${pc.bold("USAGE")}
  arc0 [command] [options]

${pc.bold("COMMANDS")}
  init        Initialize Arc0 (first-time setup)
  start       Start the daemon
  stop        Stop the daemon
  status      Check daemon status
  install     Enable auto-start on login (macOS)
  uninstall   Disable auto-start
  hooks       Manage provider hooks (install/uninstall/status)
  auth        Authentication (login/logout/secret)
  tunnel      Tunnel status and logs

${pc.bold("OPTIONS")}
  -h, --help      Show this help
  -v, --version   Show version
  -f, --foreground   Run daemon in foreground (with start)

${pc.bold("EXAMPLES")}
  arc0              Interactive menu
  arc0 start        Start daemon in background
  arc0 auth login   Login to enable Arc0 tunnel
  arc0 status       Check if daemon is running
`;

async function interactiveMode() {
  console.clear();
  printRainbowArt();
  p.intro(`${pc.bgCyan(pc.black(" Arc0 "))}`);

  const config = loadConfig();

  // First time setup
  if (!config) {
    const shouldSetup = await p.confirm({
      message: "Welcome to Arc0! Would you like to run the setup wizard?",
    });

    if (p.isCancel(shouldSetup) || !shouldSetup) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    await initCommand();
    return;
  }

  // Main menu
  const action = await p.select({
    message: "What would you like to do?",
    options: [
      {
        value: "status",
        label: "Status",
        hint: "Check daemon and connection status",
      },
      { value: "start", label: "Start", hint: "Start the daemon" },
      { value: "stop", label: "Stop", hint: "Stop the daemon" },
      {
        value: "install",
        label: "Install",
        hint: "Enable auto-start on login",
      },
      { value: "uninstall", label: "Uninstall", hint: "Disable auto-start" },
      { value: "hooks", label: "Hooks", hint: "Manage provider hooks" },
      { value: "init", label: "Init", hint: "Reconfigure Arc0" },
      {
        value: "auth",
        label: "Auth",
        hint: "Manage mobile app authentication",
      },
      { value: "tunnel", label: "Tunnel", hint: "Manage Arc0 tunnel" },
    ],
  });

  if (p.isCancel(action)) {
    p.cancel("Cancelled.");
    process.exit(0);
  }

  switch (action) {
    case "status":
      await statusCommand();
      break;
    case "start":
      await startCommand();
      break;
    case "stop":
      await stopCommand();
      break;
    case "install":
      await installCommand();
      break;
    case "uninstall":
      await uninstallCommand();
      break;
    case "hooks":
      await hooksCommand();
      break;
    case "init":
      await initCommand();
      break;
    case "auth":
      await authCommand();
      break;
    case "tunnel":
      await tunnelCommand();
      break;
  }

  p.outro("Done!");
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  const flags = args.slice(1);

  // No command = interactive mode
  if (!command) {
    await interactiveMode();
    return;
  }

  // Handle flags
  if (command === "-h" || command === "--help") {
    console.log(HELP);
    return;
  }

  if (command === "-v" || command === "--version") {
    console.log(`arc0 v${VERSION}`);
    return;
  }

  // Handle commands
  switch (command) {
    case "start": {
      const foreground = flags.includes("-f") || flags.includes("--foreground");
      await startCommand(foreground);
      break;
    }
    case "stop":
      await stopCommand();
      break;
    case "status":
      await statusCommand();
      break;
    case "init":
      await initCommand();
      break;
    case "install":
      await installCommand();
      break;
    case "uninstall":
      await uninstallCommand();
      break;
    case "hooks":
      await hooksCommand(flags[0]); // Pass subcommand: install/uninstall/status
      break;
    case "auth":
      await authCommand(flags[0]); // Pass subcommand: qr/secret/regenerate
      break;
    case "tunnel":
      await tunnelCommand(flags[0]); // Pass subcommand: status/login/logout/logs
      break;
    default:
      console.error(`Unknown command: ${command}`);
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  p.log.error(`Error: ${err.message}`);
  process.exit(1);
});
