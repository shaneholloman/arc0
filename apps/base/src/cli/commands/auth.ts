import * as p from "@clack/prompts";
import pc from "picocolors";
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import {
  FRPC_CONFIG,
  TUNNEL_DOMAIN,
  loadConfig,
  saveConfig,
  type Arc0Config,
} from "../../shared/config.js";
import {
  loadCredentials,
  ensureCredentials,
  updateTunnelAuth,
  clearTunnelAuth,
  generateSecret,
} from "../../shared/credentials.js";
import { readDaemonState } from "../../shared/pid.js";
import { isDaemonLocked } from "../../shared/lock.js";
import { ensureFrpc, frpcExists, generateRandomSubdomain, generateFrpcConfig } from "../../shared/frpc.js";
import { performDeviceAuth, validateToken } from "../../shared/device-auth.js";

const AUTH_HELP = `
${pc.bold("arc0 auth")} - Manage authentication

${pc.bold("COMMANDS")}
  login       Login to Arc0 (enables tunnel)
  logout      Logout and disable tunnel
  status      Show authentication status
  secret      Show the mobile app secret (copies to clipboard)
  regenerate  Generate a new mobile app secret

${pc.bold("EXAMPLES")}
  arc0 auth login     Login to enable Arc0 tunnel
  arc0 auth status    Check authentication status
  arc0 auth secret    Show and copy the mobile app secret
`;

/**
 * Copy text to clipboard (macOS/Linux/Windows)
 */
function copyToClipboard(text: string): boolean {
  try {
    const platform = process.platform;
    if (platform === "darwin") {
      execSync(`echo -n "${text}" | pbcopy`);
    } else if (platform === "linux") {
      execSync(`echo -n "${text}" | xclip -selection clipboard`);
    } else if (platform === "win32") {
      execSync(`echo ${text} | clip`);
    } else {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Login to Arc0 using device code flow
 */
async function loginSubcommand(): Promise<void> {
  const config = loadConfig();
  if (!config) {
    p.log.error("Arc0 not initialized. Run 'arc0 init' first.");
    return;
  }

  const existingCredentials = loadCredentials();
  if (existingCredentials?.bearerToken) {
    const user = await validateToken(existingCredentials.bearerToken);
    if (user) {
      const reauth = await p.confirm({
        message: `Already logged in as ${user.email || user.id}. Re-authenticate?`,
      });

      if (p.isCancel(reauth) || !reauth) {
        p.cancel("Cancelled.");
        return;
      }
    }
  }

  const s = p.spinner();

  try {
    // Perform device auth flow
    s.start("Requesting device code...");
    const { token, user } = await performDeviceAuth((status) => {
      if (status === "waiting") {
        s.message("Waiting for authorization...");
      }
    });
    s.stop("Authenticated!");

    // Update credentials with token
    updateTunnelAuth(token, user.id);

    // Generate random subdomain if not already set
    let subdomain = config.tunnel?.subdomain;
    if (!subdomain) {
      subdomain = generateRandomSubdomain();
    }

    // Update config with tunnel settings
    config.tunnel = {
      mode: "arc0",
      subdomain,
    };
    saveConfig(config);

    // Download frpc if needed
    if (!frpcExists()) {
      const frpcSpinner = p.spinner();
      frpcSpinner.start("Downloading frpc binary...");
      await ensureFrpc((msg) => frpcSpinner.message(msg));
      frpcSpinner.stop("frpc downloaded!");
    }

    // Generate frpc.toml
    const frpcToml = generateFrpcConfig(subdomain);
    writeFileSync(FRPC_CONFIG, frpcToml, { mode: 0o600 });

    const tunnelUrl = `https://${subdomain}.${TUNNEL_DOMAIN}`;

    p.log.success(`Logged in as ${pc.cyan(user.email || user.id)}`);
    console.log("");
    p.note(
      `Your tunnel URL:\n${pc.cyan(tunnelUrl)}\n\nThe tunnel will activate when you run 'arc0 start'.`,
      "Ready!"
    );
  } catch (error) {
    s.stop("Failed");
    p.log.error(`Login failed: ${error instanceof Error ? error.message : error}`);
  }
}

/**
 * Logout and clear credentials
 */
async function logoutSubcommand(): Promise<void> {
  const credentials = loadCredentials();

  if (!credentials?.bearerToken) {
    p.log.info("Not logged in.");
    return;
  }

  const confirm = await p.confirm({
    message: "This will clear your tunnel credentials and disable the tunnel. Continue?",
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Cancelled.");
    return;
  }

  // Stop tunnel if daemon is running
  const daemonRunning = await isDaemonLocked();
  if (daemonRunning) {
    const state = readDaemonState();
    if (state?.controlPort) {
      try {
        await fetch(`http://localhost:${state.controlPort}/api/tunnel/stop`, {
          method: "POST",
        });
        p.log.info("Tunnel stopped.");
      } catch {
        // Daemon might not be responding, that's ok
      }
    }
  }

  clearTunnelAuth();

  // Update config to remove tunnel mode
  const config = loadConfig();
  if (config?.tunnel) {
    config.tunnel.mode = "none";
    saveConfig(config);
  }

  p.log.success("Logged out. Tunnel disabled.");
}

/**
 * Show authentication status
 */
async function statusSubcommand(): Promise<void> {
  const credentials = loadCredentials();
  const config = loadConfig();

  console.log("");

  // Check Arc0 authentication
  if (!credentials?.bearerToken) {
    p.log.warn("Arc0: " + pc.yellow("Not logged in"));
    p.log.info("Run 'arc0 auth login' to authenticate.");
  } else {
    const user = await validateToken(credentials.bearerToken);
    if (!user) {
      p.log.warn("Arc0: " + pc.yellow("Token expired"));
      p.log.info("Run 'arc0 auth login' to re-authenticate.");
    } else {
      p.log.info("Arc0: " + pc.green(`Logged in as ${user.email || user.id}`));

      // Show tunnel URL if configured
      const subdomain = config?.tunnel?.subdomain;
      if (subdomain && config?.tunnel?.mode === "arc0") {
        const tunnelUrl = `https://${subdomain}.${TUNNEL_DOMAIN}`;
        p.log.info(`Tunnel URL: ${pc.cyan(tunnelUrl)}`);
      }
    }
  }

  // Check mobile app secret
  if (credentials?.secret) {
    p.log.info(`Mobile secret: ${pc.dim("configured")} (run 'arc0 auth secret' to view)`);
  }

  console.log("");
}

/**
 * Show the secret and copy to clipboard
 */
async function secretSubcommand(): Promise<void> {
  const credentials = loadCredentials();

  if (!credentials) {
    p.log.error("No credentials found. Start the daemon first with 'arc0 start'.");
    return;
  }

  const copied = copyToClipboard(credentials.secret);

  console.log("");
  p.log.info(`Secret: ${pc.cyan(credentials.secret)}`);
  console.log("");

  if (copied) {
    p.log.success("Copied to clipboard!");
  } else {
    p.log.warn("Could not copy to clipboard. Copy the secret manually.");
  }

  p.note(
    "Enter this secret in the Arc0 mobile app to connect.\nKeep it private - anyone with this secret can connect to your daemon.",
    "Instructions"
  );
}

/**
 * Regenerate the secret (invalidates existing connections)
 */
async function regenerateSubcommand(): Promise<void> {
  const existing = loadCredentials();

  if (existing) {
    const confirm = await p.confirm({
      message: "This will invalidate all existing mobile app connections. Continue?",
    });

    if (p.isCancel(confirm) || !confirm) {
      p.cancel("Cancelled.");
      return;
    }
  }

  // Only regenerate secret, preserve other fields (encryptionKey, createdAt, bearerToken, userId)
  const newCredentials = existing
    ? { ...existing, secret: generateSecret() }
    : ensureCredentials();

  const { CREDENTIALS_FILE } = await import("../../shared/config.js");
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(newCredentials, null, 2), { mode: 0o600 });

  const copied = copyToClipboard(newCredentials.secret);

  p.log.success("New secret generated!");
  console.log("");
  p.log.info(`Secret: ${pc.cyan(newCredentials.secret)}`);

  if (copied) {
    p.log.success("Copied to clipboard!");
  }

  p.log.warn("Restart the daemon for the new secret to take effect: arc0 stop && arc0 start");
}

/**
 * Main auth command handler
 */
export async function authCommand(subcommand?: string): Promise<void> {
  switch (subcommand) {
    case "login":
      await loginSubcommand();
      break;
    case "logout":
      await logoutSubcommand();
      break;
    case "status":
      await statusSubcommand();
      break;
    case "secret":
      await secretSubcommand();
      break;
    case "regenerate":
      await regenerateSubcommand();
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(AUTH_HELP);
      break;
    default:
      p.log.error(`Unknown subcommand: ${subcommand}`);
      console.log(AUTH_HELP);
      process.exit(1);
  }
}
