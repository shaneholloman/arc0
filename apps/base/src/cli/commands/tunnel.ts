import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  FRPC_CONFIG,
  TUNNEL_DOMAIN,
  FRPC_LOG,
  loadConfig,
  type Arc0Config,
} from "../../shared/config.js";
import { loadCredentials, updateTunnelAuth } from "../../shared/credentials.js";
import {
  ensureFrpc,
  getFrpcVersion,
  frpcExists,
  generateRandomSubdomain,
  generateFrpcConfig,
} from "../../shared/frpc.js";
import { performDeviceAuth, validateToken } from "../../shared/device-auth.js";

const TUNNEL_HELP = `
${pc.bold("arc0 tunnel")} - Manage Arc0 tunnel

${pc.bold("COMMANDS")}
  status      Show tunnel status and URL
  logs        Show frpc logs

${pc.bold("EXAMPLES")}
  arc0 tunnel status    Show if tunnel is configured/connected
  arc0 tunnel logs      View recent frpc logs

${pc.bold("NOTE")}
  Use 'arc0 auth login' to authenticate and enable the tunnel.
`;

/**
 * Show tunnel status
 */
async function statusSubcommand(): Promise<void> {
  const config = loadConfig();
  const credentials = loadCredentials();

  console.log("");

  // Check tunnel mode
  if (!config?.tunnel || config.tunnel.mode === "none") {
    p.log.info("Tunnel mode: " + pc.yellow("None (local/BYO)"));
    p.note(
      "You're managing your own tunnel or using local connections.\nRun 'arc0 auth login' to enable Arc0 tunnel.",
      "Info",
    );
    return;
  }

  p.log.info("Tunnel mode: " + pc.green("Arc0"));

  // Check authentication
  if (!credentials?.bearerToken) {
    p.log.warn("Status: " + pc.yellow("Not authenticated"));
    p.log.info("Run 'arc0 auth login' to authenticate.");
    return;
  }

  // Validate token is still valid
  const user = await validateToken(credentials.bearerToken);
  if (!user) {
    p.log.warn("Status: " + pc.yellow("Token expired"));
    p.log.info("Run 'arc0 auth login' to re-authenticate.");
    return;
  }

  p.log.info(`Authenticated as: ${pc.cyan(user.email || user.id)}`);

  // Show tunnel URL
  const subdomain = config.tunnel.subdomain;
  if (subdomain) {
    const tunnelUrl = `https://${subdomain}.${TUNNEL_DOMAIN}`;
    p.log.info(`Tunnel URL: ${pc.cyan(tunnelUrl)}`);
  }

  // Check if frpc binary exists
  if (frpcExists()) {
    p.log.info(`frpc version: ${pc.dim(getFrpcVersion())}`);
  } else {
    p.log.warn("frpc binary: " + pc.yellow("Not installed"));
    p.log.info("frpc will be downloaded automatically when needed.");
  }

  // Check if frpc config exists
  if (existsSync(FRPC_CONFIG)) {
    p.log.info(`frpc config: ${pc.dim(FRPC_CONFIG)}`);
  }

  console.log("");
}

/**
 * Show frpc logs
 */
async function logsSubcommand(): Promise<void> {
  if (!existsSync(FRPC_LOG)) {
    p.log.info("No frpc logs yet. Start the daemon first with 'arc0 start'.");
    return;
  }

  const logs = readFileSync(FRPC_LOG, "utf-8");
  const lines = logs.split("\n").slice(-50); // Last 50 lines

  console.log("");
  console.log(pc.bold("Recent frpc logs:"));
  console.log(pc.dim("─".repeat(60)));
  for (const line of lines) {
    if (line.trim()) {
      console.log(line);
    }
  }
  console.log(pc.dim("─".repeat(60)));
  console.log(pc.dim(`Log file: ${FRPC_LOG}`));
}

/**
 * Main tunnel command handler
 */
export async function tunnelCommand(subcommand?: string): Promise<void> {
  switch (subcommand) {
    case "status":
      await statusSubcommand();
      break;
    case "logs":
      await logsSubcommand();
      break;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(TUNNEL_HELP);
      break;
    default:
      p.log.error(`Unknown subcommand: ${subcommand}`);
      console.log(TUNNEL_HELP);
      process.exit(1);
  }
}

/**
 * Setup tunnel during init flow
 * Returns true if Arc0 tunnel was configured
 */
export async function setupTunnelDuringInit(
  config: Arc0Config,
): Promise<boolean> {
  const tunnelMode = await p.select({
    message: "How do you want to connect the mobile app?",
    options: [
      {
        value: "arc0",
        label: "🌐 Arc0 Tunnel",
        hint: "Recommended - requires login",
      },
      {
        value: "none",
        label: "📍 Local / BYO",
        hint: "Direct LAN or manage your own tunnel",
      },
    ],
  });

  if (p.isCancel(tunnelMode)) {
    return false;
  }

  if (tunnelMode === "none") {
    config.tunnel = { mode: "none" };
    return false;
  }

  // Arc0 tunnel selected - trigger login
  const s = p.spinner();
  s.start("Setting up Arc0 tunnel...");

  try {
    const { token, user } = await performDeviceAuth((status) => {
      if (status === "waiting") {
        s.message("Waiting for authorization...");
      }
    });
    s.stop("Authenticated!");

    // Update credentials
    updateTunnelAuth(token, user.id);

    // Generate random subdomain
    const subdomain = generateRandomSubdomain();

    config.tunnel = {
      mode: "arc0",
      subdomain,
    };

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
    p.log.success(`Tunnel configured: ${pc.cyan(tunnelUrl)}`);

    return true;
  } catch (error) {
    s.stop("Failed");
    p.log.error(
      `Tunnel setup failed: ${error instanceof Error ? error.message : error}`,
    );
    p.log.info("You can try again later with 'arc0 auth login'.");
    config.tunnel = { mode: "none" };
    return false;
  }
}
