import { spawn, type ChildProcess } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import {
  FRPC_BINARY,
  FRPC_CONFIG,
  FRPC_LOG,
  TUNNEL_DOMAIN,
  type Arc0Config,
} from "../shared/config.js";
import { loadCredentials } from "../shared/credentials.js";
import { frpcExists, generateFrpcConfig } from "../shared/frpc.js";

export type TunnelStatus =
  | "disabled"
  | "not_configured"
  | "starting"
  | "connected"
  | "disconnected"
  | "error";

export interface FrpcManagerStatus {
  status: TunnelStatus;
  tunnelUrl?: string;
  error?: string;
  pid?: number;
  restartCount: number;
}

export interface FrpcManagerOptions {
  config: Arc0Config;
  socketPort: number;
  onStatusChange?: (status: FrpcManagerStatus) => void;
}

/**
 * Manages the frpc child process for Arc0 tunnel.
 */
export class FrpcManager {
  private process: ChildProcess | null = null;
  private status: TunnelStatus = "disabled";
  private error?: string;
  private restartCount = 0;
  private maxRestarts = 5;
  private restartDelay = 5000; // 5 seconds
  private restartTimeout?: NodeJS.Timeout;
  private config: Arc0Config;
  private socketPort: number;
  private onStatusChange?: (status: FrpcManagerStatus) => void;
  private stopping = false;

  constructor(options: FrpcManagerOptions) {
    this.config = options.config;
    this.socketPort = options.socketPort;
    this.onStatusChange = options.onStatusChange;
  }

  /**
   * Check if tunnel is configured and can be started.
   */
  canStart(): { ok: boolean; reason?: string } {
    // Check tunnel mode
    if (!this.config.tunnel || this.config.tunnel.mode !== "arc0") {
      return { ok: false, reason: "Tunnel mode is not 'arc0'" };
    }

    // Check subdomain
    if (!this.config.tunnel.subdomain) {
      return { ok: false, reason: "No subdomain configured" };
    }

    // Check credentials
    const credentials = loadCredentials();
    if (!credentials?.bearerToken) {
      return { ok: false, reason: "Not authenticated (no bearer token)" };
    }

    // Check frpc binary
    if (!frpcExists()) {
      return { ok: false, reason: "frpc binary not found" };
    }

    // Note: frpc.toml is regenerated on start, no need to check existence

    return { ok: true };
  }

  /**
   * Start the frpc process.
   */
  async start(): Promise<void> {
    const check = this.canStart();
    if (!check.ok) {
      console.log(`[frpc] Cannot start: ${check.reason}`);
      this.status = "not_configured";
      this.notifyStatusChange();
      return;
    }

    this.stopping = false;
    this.status = "starting";
    this.notifyStatusChange();

    console.log(`[frpc] Starting frpc...`);

    // Regenerate frpc.toml to ensure it uses env var for port
    const subdomain = this.config.tunnel?.subdomain;
    if (subdomain) {
      const configContent = generateFrpcConfig(subdomain);
      writeFileSync(FRPC_CONFIG, configContent, { mode: 0o600 });
      console.log(`[frpc] Regenerated config for subdomain: ${subdomain}`);
    }

    // Clear log file on start
    writeFileSync(FRPC_LOG, `[${new Date().toISOString()}] Starting frpc...\n`);

    // Get bearer token from credentials
    const credentials = loadCredentials();
    const bearerToken = credentials?.bearerToken || "";

    this.process = spawn(FRPC_BINARY, ["-c", FRPC_CONFIG], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        ARC0_BEARER_TOKEN: bearerToken,
        ARC0_SOCKET_PORT: String(this.socketPort),
      },
    });

    // Handle stdout
    this.process.stdout?.on("data", (data: Buffer) => {
      const output = data.toString();
      this.log(output);
      this.parseOutput(output);
    });

    // Handle stderr
    this.process.stderr?.on("data", (data: Buffer) => {
      const output = data.toString();
      this.log(`[stderr] ${output}`);
      this.parseOutput(output);
    });

    // Handle exit
    this.process.on("exit", (code, signal) => {
      this.log(`[exit] code=${code} signal=${signal}`);
      console.log(`[frpc] Process exited: code=${code} signal=${signal}`);

      this.process = null;

      if (this.stopping) {
        this.status = "disabled";
        this.notifyStatusChange();
        return;
      }

      if (code !== 0) {
        this.status = "disconnected";
        this.error = `Process exited with code ${code}`;
        this.notifyStatusChange();

        // Auto-restart if under max restarts
        this.scheduleRestart();
      }
    });

    // Handle error
    this.process.on("error", (err) => {
      console.error(`[frpc] Process error:`, err);
      this.log(`[error] ${err.message}`);
      this.status = "error";
      this.error = err.message;
      this.notifyStatusChange();
    });

    console.log(`[frpc] Started with PID ${this.process.pid}`);
  }

  /**
   * Stop the frpc process.
   */
  async stop(): Promise<void> {
    this.stopping = true;

    // Clear restart timeout
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = undefined;
    }

    if (!this.process) {
      this.status = "disabled";
      return;
    }

    console.log(`[frpc] Stopping...`);

    return new Promise((resolve) => {
      if (!this.process) {
        resolve();
        return;
      }

      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown fails
        this.process?.kill("SIGKILL");
      }, 5000);

      this.process.once("exit", () => {
        clearTimeout(timeout);
        this.process = null;
        this.status = "disabled";
        this.notifyStatusChange();
        console.log(`[frpc] Stopped`);
        resolve();
      });

      this.process.kill("SIGTERM");
    });
  }

  /**
   * Get current status.
   */
  getStatus(): FrpcManagerStatus {
    return {
      status: this.status,
      tunnelUrl: this.getTunnelUrl(),
      error: this.error,
      pid: this.process?.pid,
      restartCount: this.restartCount,
    };
  }

  /**
   * Get the tunnel URL if configured.
   */
  getTunnelUrl(): string | undefined {
    const subdomain = this.config.tunnel?.subdomain;
    if (subdomain) {
      return `https://${subdomain}.${TUNNEL_DOMAIN}`;
    }
    return undefined;
  }

  /**
   * Parse frpc output to detect connection status.
   */
  private parseOutput(output: string): void {
    // Detect successful connection
    if (
      output.includes("login to server success") ||
      output.includes("start proxy success")
    ) {
      this.status = "connected";
      this.error = undefined;
      this.restartCount = 0; // Reset on successful connect
      this.notifyStatusChange();
      console.log(`[frpc] Connected! URL: ${this.getTunnelUrl()}`);
    }

    // Detect connection errors
    if (
      output.includes("login to the server failed") ||
      output.includes("connect to server error") ||
      output.includes("proxy already exists")
    ) {
      this.status = "error";
      this.error = output.trim();
      this.notifyStatusChange();
    }

    // Detect disconnect
    if (output.includes("connection closed") || output.includes("EOF")) {
      this.status = "disconnected";
      this.notifyStatusChange();
    }
  }

  /**
   * Schedule a restart with exponential backoff.
   */
  private scheduleRestart(): void {
    if (this.stopping) return;

    if (this.restartCount >= this.maxRestarts) {
      console.log(`[frpc] Max restarts (${this.maxRestarts}) reached, giving up`);
      this.status = "error";
      this.error = "Max restarts reached";
      this.notifyStatusChange();
      return;
    }

    const delay = this.restartDelay * Math.pow(2, this.restartCount);
    console.log(
      `[frpc] Scheduling restart #${this.restartCount + 1} in ${delay / 1000}s`
    );

    this.restartTimeout = setTimeout(() => {
      this.restartCount++;
      this.start();
    }, delay);
  }

  /**
   * Append to log file.
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const lines = message.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      appendFileSync(FRPC_LOG, `[${timestamp}] ${line}\n`);
    }
  }

  /**
   * Notify status change callback.
   */
  private notifyStatusChange(): void {
    this.onStatusChange?.(this.getStatus());
  }
}

/**
 * Create and optionally start FrpcManager if tunnel is configured.
 */
export async function createFrpcManager(
  config: Arc0Config,
  socketPort: number,
  onStatusChange?: (status: FrpcManagerStatus) => void
): Promise<FrpcManager | null> {
  // Skip if tunnel not configured
  if (!config.tunnel || config.tunnel.mode !== "arc0") {
    console.log(`[frpc] Tunnel not configured, skipping`);
    return null;
  }

  const manager = new FrpcManager({
    config,
    socketPort,
    onStatusChange,
  });

  // Check if we can start
  const check = manager.canStart();
  if (!check.ok) {
    console.log(`[frpc] Cannot start: ${check.reason}`);
    return manager;
  }

  // Start the tunnel
  await manager.start();

  return manager;
}
