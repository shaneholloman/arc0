import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import pkg from "../../package.json" with { type: "json" };

export const VERSION = pkg.version;

export type RuntimeMode = "production" | "development" | "test";

function resolveRuntimeMode(): RuntimeMode {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") return "production";
  if (nodeEnv === "test") return "test";
  return "development";
}

export const RUNTIME_MODE = resolveRuntimeMode();
export const IS_DEV = RUNTIME_MODE === "development";
export const IS_TEST = RUNTIME_MODE === "test";

const BASE_DIR_NAME =
  RUNTIME_MODE === "production"
    ? ".arc0"
    : RUNTIME_MODE === "test"
      ? ".arc0-test"
      : ".arc0-dev";

export const CONFIG_DIR = join(homedir(), BASE_DIR_NAME);
export const CONFIG_FILE = join(CONFIG_DIR, "config.json");
export const PID_FILE = join(CONFIG_DIR, "daemon.pid");
export const STATE_FILE = join(CONFIG_DIR, "daemon.state.json");
export const LOG_FILE = join(CONFIG_DIR, "daemon.log");
export const SESSIONS_DIR = join(CONFIG_DIR, "sessions");
export const HOOKS_DIR = join(CONFIG_DIR, "hooks");
export const LOCK_FILE = join(CONFIG_DIR, "daemon.lock");
export const CREDENTIALS_FILE = join(CONFIG_DIR, ".credentials.json");

// Tunnel-related paths
export const BIN_DIR = join(CONFIG_DIR, "bin");
export const FRPC_BINARY = join(BIN_DIR, "frpc");
export const FRPC_CONFIG = join(CONFIG_DIR, "frpc.toml");
export const FRPC_LOG = join(CONFIG_DIR, "frpc.log");

// Tunnel constants (hardcoded)
export const FRPS_SERVER = "arc0-frps.fly.dev";
export const FRPS_PORT = 7000;
export const TUNNEL_DOMAIN = "t.arc0.ai";

// Claude Code settings
export const CLAUDE_SETTINGS_FILE = join(homedir(), ".claude", "settings.json");

export interface DaemonState {
  version: string;
  pid: number;
  controlPort: number;
  socketPort: number;
  startedAt: string;
}

export interface TunnelConfig {
  mode: "arc0" | "none";
  subdomain?: string;
}

export interface PortPreferences {
  controlPort?: number;
  socketPort?: number;
}

export interface Arc0Config {
  version: string;
  workstationId: string;
  enabledProviders: {
    claude: boolean;
    codex: boolean;
    gemini: boolean;
  };
  watchPaths: {
    claude?: string;
    codex?: string;
    gemini?: string;
  };
  tunnel?: TunnelConfig;
  portPreferences?: PortPreferences;
}

export const DEFAULT_CONFIG: Arc0Config = {
  version: VERSION,
  workstationId: "",
  enabledProviders: {
    claude: true,
    codex: false,
    gemini: false,
  },
  watchPaths: {},
};

export function loadConfig(): Arc0Config | null {
  try {
    const content = readFileSync(CONFIG_FILE, "utf-8");
    return JSON.parse(content) as Arc0Config;
  } catch {
    return null;
  }
}

export function saveConfig(config: Arc0Config): void {
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}
