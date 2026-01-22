import * as p from "@clack/prompts";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  DEFAULT_CONFIG,
  TUNNEL_DOMAIN,
  type Arc0Config,
} from "../../shared/config.js";
import { ensureCredentials } from "../../shared/credentials.js";
import { setupTunnelDuringInit } from "./tunnel.js";

export async function initCommand(): Promise<void> {
  p.log.info("Let's configure Arc0...");

  // Select providers
  const providers = await p.multiselect({
    message: "Which AI coding assistants do you use?",
    options: [
      { value: "claude", label: "Claude Code", hint: "Anthropic" },
      { value: "codex", label: "Codex CLI", hint: "OpenAI" },
      { value: "gemini", label: "Gemini CLI", hint: "Google" },
    ],
    initialValues: ["claude"],
    required: true,
  });

  if (p.isCancel(providers)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  // Generate workstation ID
  const s = p.spinner();
  s.start("Generating workstation ID...");

  const workstationId = `${hostname()}-${randomBytes(3).toString("hex")}`;

  await new Promise((r) => setTimeout(r, 500)); // Brief pause for UX
  s.stop("Workstation ID generated");

  // Save config
  const config: Arc0Config = {
    ...DEFAULT_CONFIG,
    workstationId,
    enabledProviders: {
      claude: providers.includes("claude"),
      codex: providers.includes("codex"),
      gemini: providers.includes("gemini"),
    },
  };

  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }

  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");

  p.log.success(`Configuration saved to ${CONFIG_FILE}`);

  // Generate credentials (secret + encryption key) with secure permissions
  ensureCredentials();

  // Setup tunnel (modifies config.tunnel)
  await setupTunnelDuringInit(config);

  // Save config again with tunnel settings
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");

  // Install hooks for selected providers
  if (providers.includes("claude")) {
    const installHooks = await p.confirm({
      message: "Install Claude Code session hooks?",
      initialValue: true,
    });

    if (!p.isCancel(installHooks) && installHooks) {
      const { installClaudeHooks } = await import("./hooks.js");
      await installClaudeHooks();
    }
  }

  // TODO: Add Codex and Gemini hook installation when implemented

  const summaryLines = [
    `Workstation: ${workstationId}`,
    `Providers: ${providers.join(", ")}`,
  ];

  if (config.tunnel?.mode === "arc0" && config.tunnel.subdomain) {
    summaryLines.push(`Tunnel: https://${config.tunnel.subdomain}.${TUNNEL_DOMAIN}`);
  } else {
    summaryLines.push(`Tunnel: Local / BYO`);
  }

  p.note(summaryLines.join("\n"), "Configuration Summary");

  if (config.tunnel?.mode !== "arc0") {
    p.log.info("Run 'arc0 auth login' to enable Arc0 tunnel for mobile access.");
  }

  // Ask to start daemon
  const startNow = await p.confirm({
    message: "Would you like to start the daemon now?",
    initialValue: true,
  });

  if (p.isCancel(startNow)) {
    p.cancel("Setup complete. Run 'arc0' to start the daemon later.");
    return;
  }

  if (startNow) {
    const { startCommand } = await import("./start.js");
    await startCommand();
  }
}
