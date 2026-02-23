import * as p from "@clack/prompts";
import pc from "picocolors";
import { writeFileSync } from "node:fs";
import {
  FRPC_CONFIG,
  TUNNEL_DOMAIN,
  loadConfig,
  saveConfig,
} from "../../lib/config.js";
import {
  loadCredentials,
  updateTunnelAuth,
  clearTunnelAuth,
} from "../../lib/credentials.js";
import { readDaemonState } from "../../lib/pid.js";
import { isDaemonLocked } from "../../lib/lock.js";
import {
  ensureFrpc,
  frpcExists,
  generateRandomSubdomain,
  generateFrpcConfig,
} from "../../lib/frpc.js";
import { performDeviceAuth, validateToken } from "../../lib/device-auth.js";

const AUTH_HELP = `
${pc.bold("arc0 auth")} - Manage authentication

${pc.bold("COMMANDS")}
  login       Login to Arc0 (enables tunnel)
  logout      Logout and disable tunnel
  status      Show authentication status

${pc.bold("EXAMPLES")}
  arc0 auth login     Login to enable Arc0 tunnel
  arc0 auth status    Check authentication status
`;

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
    const frpcToml = generateFrpcConfig(subdomain, config.workstationId);
    writeFileSync(FRPC_CONFIG, frpcToml, { mode: 0o600 });

    const tunnelUrl = `https://${subdomain}.${TUNNEL_DOMAIN}`;

    p.log.success(`Logged in as ${pc.cyan(user.email || user.id)}`);
    console.log("");
    p.note(
      `Your tunnel URL:\n${pc.cyan(tunnelUrl)}\n\nThe tunnel will activate when you run 'arc0 start'.`,
      "Ready!",
    );
  } catch (error) {
    s.stop("Failed");
    p.log.error(
      `Login failed: ${error instanceof Error ? error.message : error}`,
    );
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
    message:
      "This will clear your tunnel credentials and disable the tunnel. Continue?",
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

  console.log("");
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
