import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync } from "node:fs";
import { isDaemonLocked } from "../../shared/lock.js";
import { readDaemonState } from "../../shared/pid.js";
import { TUNNEL_DOMAIN, loadConfig, type Arc0Config } from "../../shared/config.js";
import { PLIST_PATH, isLaunchAgentLoaded } from "./install.js";
import { loadCredentials } from "../../shared/credentials.js";

interface DaemonApiStatus {
  running: boolean;
  uptime: number;
  clientCount: number;
  sessionCount: number;
}

interface DaemonApiClients {
  clients: Array<{
    socketId: string;
    deviceId: string | null;
    connectedAt: string;
    lastAckAt: string | null;
  }>;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}

async function fetchDaemonApi<T>(port: number, endpoint: string): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${port}${endpoint}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function statusCommand(): Promise<void> {
  const config = loadConfig();
  const running = await isDaemonLocked();
  const state = readDaemonState();

  if (!running) {
    p.log.warn("Daemon is not running");
    p.note(`Run 'arc0 start' to launch the daemon`, "Tip");
    return;
  }

  const s = p.spinner();
  s.start("Checking daemon status...");

  // Use control port from state file
  const controlPort = state?.controlPort;
  if (!controlPort) {
    s.stop("Status check failed");
    p.log.error("Daemon state missing controlPort");
    return;
  }

  // Fetch status from HTTP API (control server)
  const apiStatus = await fetchDaemonApi<DaemonApiStatus>(controlPort, "/api/status");
  const apiClients = await fetchDaemonApi<DaemonApiClients>(controlPort, "/api/clients");

  s.stop("Status check complete");

  const enabledProviders = config?.enabledProviders
    ? Object.entries(config.enabledProviders)
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(", ")
    : "none";

  // Check auto-start status (macOS only)
  const autoStartStatus =
    process.platform === "darwin"
      ? existsSync(PLIST_PATH) && isLaunchAgentLoaded()
        ? "✓ enabled"
        : "✗ disabled"
      : "N/A (macOS only)";

  if (!apiStatus) {
    const statusInfo = [
      `Status: ✓ Running (not responding)`,
      `PID: ${state?.pid ?? "N/A"}`,
      `Control Port: ${state?.controlPort ?? "N/A"}`,
      `Socket Port: ${state?.socketPort ?? "N/A"}`,
      `Auto-start: ${autoStartStatus}`,
      `Providers: ${enabledProviders}`,
    ].join("\n");
    p.note(statusInfo, "Daemon Status");
    return;
  }

  // Get tunnel status
  let tunnelInfo = "✗ Not configured";
  if (config?.tunnel?.mode === "arc0") {
    const credentials = loadCredentials();
    const subdomain = config.tunnel.subdomain;
    if (subdomain && credentials?.bearerToken) {
      tunnelInfo = `✓ ${pc.cyan(`https://${subdomain}.${TUNNEL_DOMAIN}`)}`;
    } else if (!credentials?.bearerToken) {
      tunnelInfo = "⚠ Not authenticated (run 'arc0 auth login')";
    } else {
      tunnelInfo = "⚠ No subdomain configured";
    }
  } else if (config?.tunnel?.mode === "none") {
    tunnelInfo = "Local / BYO";
  }

  const statusInfo = [
    `Status: ✓ Running`,
    `PID: ${state?.pid ?? "N/A"}`,
    `Control Port: ${state?.controlPort ?? "N/A"}`,
    `Socket Port: ${state?.socketPort ?? "N/A"}`,
    `Uptime: ${formatUptime(apiStatus.uptime)}`,
    `Auto-start: ${autoStartStatus}`,
    `Providers: ${enabledProviders}`,
    `Tunnel: ${tunnelInfo}`,
    ``,
    `Sessions: ${apiStatus.sessionCount}`,
    `Connected Clients: ${apiStatus.clientCount}`,
  ].join("\n");

  p.note(statusInfo, "Daemon Status");

  // Show connected clients if any
  if (apiClients?.clients && apiClients.clients.length > 0) {
    const clientLines = apiClients.clients.map((c) => {
      const deviceId = c.deviceId ?? "unknown";
      const connectedAt = new Date(c.connectedAt).toLocaleTimeString();
      return `  ${deviceId}  connected at ${connectedAt}`;
    });
    p.note(clientLines.join("\n"), "Connected Devices");
  }
}
