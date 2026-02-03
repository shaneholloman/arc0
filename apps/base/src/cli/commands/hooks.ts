import * as p from "@clack/prompts";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import {
  CONFIG_DIR,
  HOOKS_DIR,
  SESSIONS_DIR,
  CLAUDE_SETTINGS_FILE,
  loadConfig,
  type Arc0Config,
} from "../../shared/config.js";
import { CLAUDE_SESSION_SCRIPT } from "../hooks/claude-session.embedded.js";

const CLAUDE_HOOK_DEST = join(HOOKS_DIR, "claude-session.js");

interface ClaudeSettings {
  hooks?: {
    SessionStart?: Array<{ hooks: Array<{ type: string; command: string }> }>;
    SessionEnd?: Array<{ hooks: Array<{ type: string; command: string }> }>;
    PermissionRequest?: Array<{
      hooks: Array<{ type: string; command: string }>;
    }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

function loadClaudeSettings(): ClaudeSettings {
  try {
    const content = readFileSync(CLAUDE_SETTINGS_FILE, "utf-8");
    return JSON.parse(content) as ClaudeSettings;
  } catch {
    return {};
  }
}

function saveClaudeSettings(settings: ClaudeSettings): void {
  const dir = dirname(CLAUDE_SETTINGS_FILE);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(
    CLAUDE_SETTINGS_FILE,
    JSON.stringify(settings, null, 2),
    "utf-8",
  );
}

function isClaudeHookInstalled(): boolean {
  const settings = loadClaudeSettings();
  const sessionStart = settings.hooks?.SessionStart;
  const sessionEnd = settings.hooks?.SessionEnd;
  const permissionRequest = settings.hooks?.PermissionRequest;

  const hasStart = sessionStart?.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
  );
  const hasEnd = sessionEnd?.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
  );
  const hasPermission = permissionRequest?.some((entry) =>
    entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
  );

  return Boolean(hasStart && hasEnd && hasPermission);
}

export async function installClaudeHooks(): Promise<boolean> {
  const s = p.spinner();
  s.start("Installing Claude Code hooks...");

  try {
    // Ensure directories exist
    if (!existsSync(HOOKS_DIR)) {
      mkdirSync(HOOKS_DIR, { recursive: true });
    }
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    // Use embedded script template and replace placeholder with config dir
    const hookScript = CLAUDE_SESSION_SCRIPT.replace(
      "__CONFIG_DIR__",
      CONFIG_DIR,
    );
    writeFileSync(CLAUDE_HOOK_DEST, hookScript, "utf-8");

    // Load and update Claude settings
    const settings = loadClaudeSettings();

    if (!settings.hooks) {
      settings.hooks = {};
    }

    const hookEntry = {
      hooks: [
        {
          type: "command",
          command: `node ${CLAUDE_HOOK_DEST}`,
        },
      ],
    };

    // Add SessionStart hook if not present
    if (!settings.hooks.SessionStart) {
      settings.hooks.SessionStart = [];
    }
    const hasStart = settings.hooks.SessionStart.some((entry) =>
      entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
    );
    if (!hasStart) {
      settings.hooks.SessionStart.push(hookEntry);
    }

    // Add SessionEnd hook if not present
    if (!settings.hooks.SessionEnd) {
      settings.hooks.SessionEnd = [];
    }
    const hasEnd = settings.hooks.SessionEnd.some((entry) =>
      entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
    );
    if (!hasEnd) {
      settings.hooks.SessionEnd.push(hookEntry);
    }

    // Add PermissionRequest hook if not present
    if (!settings.hooks.PermissionRequest) {
      settings.hooks.PermissionRequest = [];
    }
    const hasPermission = settings.hooks.PermissionRequest.some((entry) =>
      entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
    );
    if (!hasPermission) {
      settings.hooks.PermissionRequest.push(hookEntry);
    }

    saveClaudeSettings(settings);

    s.stop("Claude Code hooks installed");
    return true;
  } catch (err) {
    s.stop("Failed to install hooks");
    p.log.error(`Error: ${err}`);
    return false;
  }
}

export async function uninstallClaudeHooks(): Promise<boolean> {
  const s = p.spinner();
  s.start("Uninstalling Claude Code hooks...");

  try {
    // Remove hook script
    try {
      unlinkSync(CLAUDE_HOOK_DEST);
    } catch {
      // File may not exist
    }

    // Load and update Claude settings
    const settings = loadClaudeSettings();

    if (settings.hooks?.SessionStart) {
      settings.hooks.SessionStart = settings.hooks.SessionStart.filter(
        (entry) =>
          !entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
      );
      if (settings.hooks.SessionStart.length === 0) {
        delete settings.hooks.SessionStart;
      }
    }

    if (settings.hooks?.SessionEnd) {
      settings.hooks.SessionEnd = settings.hooks.SessionEnd.filter(
        (entry) =>
          !entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
      );
      if (settings.hooks.SessionEnd.length === 0) {
        delete settings.hooks.SessionEnd;
      }
    }

    if (settings.hooks?.PermissionRequest) {
      settings.hooks.PermissionRequest =
        settings.hooks.PermissionRequest.filter(
          (entry) =>
            !entry.hooks?.some((h) => h.command?.includes("claude-session.js")),
        );
      if (settings.hooks.PermissionRequest.length === 0) {
        delete settings.hooks.PermissionRequest;
      }
    }

    // Clean up empty hooks object
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    saveClaudeSettings(settings);

    s.stop("Claude Code hooks uninstalled");
    return true;
  } catch (err) {
    s.stop("Failed to uninstall hooks");
    p.log.error(`Error: ${err}`);
    return false;
  }
}

export async function hooksStatusCommand(): Promise<void> {
  const config = loadConfig();

  const claudeEnabled = config?.enabledProviders?.claude ?? false;
  const claudeInstalled = isClaudeHookInstalled();

  const statusLines = [
    `Claude Code: ${claudeEnabled ? "enabled" : "disabled"}`,
    `  Hook installed: ${claudeInstalled ? "✓ yes" : "✗ no"}`,
    `  Hook path: ${CLAUDE_HOOK_DEST}`,
    `  Sessions dir: ${SESSIONS_DIR}`,
  ];

  // TODO: Add Codex and Gemini status when implemented

  p.note(statusLines.join("\n"), "Hooks Status");
}

export async function hooksCommand(subcommand?: string): Promise<void> {
  const config = loadConfig();

  if (!config) {
    p.log.error("Arc0 is not configured. Run 'arc0 init' first.");
    return;
  }

  switch (subcommand) {
    case "install":
      if (config.enabledProviders.claude) {
        await installClaudeHooks();
      } else {
        p.log.warn(
          "Claude Code is not enabled. Enable it in 'arc0 init' first.",
        );
      }
      // TODO: Add Codex and Gemini
      break;

    case "uninstall":
      await uninstallClaudeHooks();
      // TODO: Add Codex and Gemini
      break;

    case "status":
      await hooksStatusCommand();
      break;

    default:
      // Interactive mode
      const action = await p.select({
        message: "What would you like to do?",
        options: [
          { value: "status", label: "Status", hint: "Check installed hooks" },
          {
            value: "install",
            label: "Install",
            hint: "Install hooks for enabled providers",
          },
          { value: "uninstall", label: "Uninstall", hint: "Remove all hooks" },
        ],
      });

      if (p.isCancel(action)) {
        p.cancel("Cancelled.");
        return;
      }

      await hooksCommand(action as string);
  }
}
