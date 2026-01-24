/**
 * arc0 pair - Start device pairing session
 *
 * Displays a pairing code for the mobile app to enter.
 * Uses SPAKE2 for secure key exchange.
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import QRCode from "qrcode";
import { isDaemonLocked } from "../../shared/lock.js";
import { readDaemonState } from "../../shared/pid.js";
import { TUNNEL_DOMAIN, loadConfig } from "../../shared/config.js";

interface PairingStartResponse {
  formattedCode: string;
  expiresIn: number;
}

interface PairingStatusResponse {
  active: boolean;
  code?: string;
  remainingMs?: number;
  deviceName?: string;
  deviceId?: string;
  completed?: boolean;
}

async function fetchDaemonApi<T>(
  port: number,
  endpoint: string,
  options?: RequestInit,
): Promise<T | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`http://localhost:${port}${endpoint}`, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function pairCommand(): Promise<void> {
  const running = await isDaemonLocked();

  if (!running) {
    p.log.error("Daemon is not running");
    p.note(`Run ${pc.cyan("arc0 start")} first`, "Tip");
    return;
  }

  const state = readDaemonState();
  const controlPort = state?.controlPort;

  if (!controlPort) {
    p.log.error("Could not find daemon control port");
    return;
  }

  const s = p.spinner();
  s.start("Starting pairing session...");

  // Start pairing session
  const result = await fetchDaemonApi<PairingStartResponse>(
    controlPort,
    "/api/pairing/start",
    { method: "POST" },
  );

  if (!result) {
    s.stop("Failed to start pairing session");
    p.log.error("Could not communicate with daemon");
    return;
  }

  s.stop("Pairing session started");

  // Check if tunnel is configured
  const config = loadConfig();
  const tunnelHost =
    config?.tunnel?.mode === "arc0" && config.tunnel.subdomain
      ? `${config.tunnel.subdomain}.${TUNNEL_DOMAIN}`
      : null;
  const tunnelUrl = tunnelHost ? `https://${tunnelHost}` : null;

  // Build connect URL if tunnel is configured
  // Note: arc0.ai/connect normalizes URLs, so we omit https:// to keep URL shorter
  const connectUrl = tunnelHost
    ? `https://arc0.ai/connect?url=${encodeURIComponent(tunnelHost)}&code=${result.formattedCode.replace(/-/g, "")}`
    : null;

  // Generate QR code if connect URL is available
  let qrCode = "";
  if (connectUrl) {
    try {
      qrCode = await QRCode.toString(connectUrl, {
        type: "terminal",
        small: true,
        errorCorrectionLevel: "L",
      });
    } catch {
      // QR generation failed, continue without it
    }
  }

  // Display the pairing info
  const noteContent = connectUrl
    ? (qrCode ? `${qrCode}\n` : "") +
      `Visit this URL to connect quickly:\n${pc.magenta(connectUrl)}\n\n` +
      `Or enter the code manually in the Arc0 app:\n${pc.bold("Add Workstation")} → ${pc.bold("Enter Pairing Code")}\n\n` +
      `${pc.bold("Pairing Code:")} ${pc.cyan(result.formattedCode)}\n` +
      `${pc.bold("Workstation URL:")} ${pc.cyan(tunnelUrl)}`
    : `${pc.bold("Pairing Code:")}\n${pc.cyan(result.formattedCode)}\n\n` +
      `Enter this code in the Arc0 app:\n${pc.bold("Add Workstation")} → ${pc.bold("Enter Pairing Code")}`;

  p.note(noteContent, "Connect Your Device");

  // Poll for completion
  const pollS = p.spinner();
  pollS.start(
    `Waiting for device to connect... (expires in ${Math.floor(result.expiresIn / 1000)}s)`,
  );

  let attempts = 0;
  const maxAttempts = Math.ceil(result.expiresIn / 2000); // Poll every 2 seconds

  while (attempts < maxAttempts) {
    await sleep(2000);
    attempts++;

    const status = await fetchDaemonApi<PairingStatusResponse>(
      controlPort,
      "/api/pairing/status",
    );

    if (!status) {
      pollS.stop("Lost connection to daemon");
      return;
    }

    if (status.completed) {
      pollS.stop("Device connected!");
      p.log.success(
        `Paired with ${pc.cyan(status.deviceName ?? "Unknown Device")}`,
      );
      p.note(
        `Device ID: ${status.deviceId}\n\nThe device can now connect securely to this workstation.`,
        "Pairing Complete",
      );
      return;
    }

    if (!status.active) {
      pollS.stop("Pairing session ended");
      p.log.warn("Pairing session expired or was cancelled");
      return;
    }

    const remaining = Math.floor((status.remainingMs ?? 0) / 1000);
    if (remaining > 0 && remaining % 30 === 0) {
      pollS.message(
        `Waiting for device to connect... (${remaining}s remaining)`,
      );
    }
  }

  pollS.stop("Pairing session expired");
  p.log.warn("No device connected within the timeout period");
  p.note(`Run ${pc.cyan("arc0 pair")} to start a new session`, "Tip");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
