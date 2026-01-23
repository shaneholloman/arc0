/**
 * arc0 clients - Manage paired devices
 *
 * Subcommands:
 * - list: Show all paired devices
 * - revoke <deviceId>: Revoke a device's access
 */

import * as p from "@clack/prompts";
import pc from "picocolors";
import { listClients, revokeClient, type ClientRecord } from "../../shared/clients.js";

export async function clientsCommand(subcommand?: string, arg?: string): Promise<void> {
  switch (subcommand) {
    case "list":
    case undefined:
      await listClientsCommand();
      break;
    case "revoke":
      await revokeClientCommand(arg);
      break;
    default:
      p.log.error(`Unknown subcommand: ${subcommand}`);
      showHelp();
  }
}

async function listClientsCommand(): Promise<void> {
  const clients = listClients();

  if (clients.length === 0) {
    p.log.info("No paired devices");
    p.note(`Run ${pc.cyan("arc0 pair")} to pair a new device`, "Tip");
    return;
  }

  console.log();
  p.log.info(`${pc.bold("Paired Devices")} (${clients.length})`);
  console.log();

  for (const client of clients) {
    const name = client.deviceName ?? "Unknown Device";
    const created = new Date(client.createdAt).toLocaleDateString();
    const lastSeen = client.lastSeen
      ? formatRelativeTime(new Date(client.lastSeen))
      : "Never";

    console.log(`  ${pc.cyan(name)}`);
    console.log(`  │ ID: ${pc.dim(client.deviceId)}`);
    console.log(`  │ Paired: ${created}`);
    console.log(`  │ Last seen: ${lastSeen}`);
    console.log();
  }

  p.note(
    `To revoke access: ${pc.cyan("arc0 clients revoke <deviceId>")}`,
    "Tip"
  );
}

async function revokeClientCommand(deviceId?: string): Promise<void> {
  if (!deviceId) {
    // Interactive mode - let user select
    const clients = listClients();

    if (clients.length === 0) {
      p.log.info("No paired devices to revoke");
      return;
    }

    const selected = await p.select({
      message: "Select device to revoke:",
      options: clients.map((c) => ({
        value: c.deviceId,
        label: c.deviceName ?? c.deviceId,
        hint: `Paired ${new Date(c.createdAt).toLocaleDateString()}`,
      })),
    });

    if (p.isCancel(selected)) {
      p.cancel("Cancelled");
      return;
    }

    deviceId = selected as string;
  }

  // Find the client to show name
  const clients = listClients();
  const client = clients.find((c) => c.deviceId === deviceId);

  if (!client) {
    p.log.error(`Device not found: ${deviceId}`);
    return;
  }

  const confirm = await p.confirm({
    message: `Revoke access for "${client.deviceName ?? deviceId}"?`,
  });

  if (p.isCancel(confirm) || !confirm) {
    p.cancel("Cancelled");
    return;
  }

  const success = revokeClient(deviceId);

  if (success) {
    p.log.success(`Revoked access for ${pc.cyan(client.deviceName ?? deviceId)}`);
    p.note(
      "The device will be disconnected and must pair again to reconnect.",
      "Note"
    );
  } else {
    p.log.error("Failed to revoke device");
  }
}

function showHelp(): void {
  console.log(`
${pc.bold("Usage:")} arc0 clients <command>

${pc.bold("Commands:")}
  list              List all paired devices
  revoke <id>       Revoke a device's access

${pc.bold("Examples:")}
  arc0 clients              Show paired devices
  arc0 clients list         Show paired devices
  arc0 clients revoke       Interactive device selection
  arc0 clients revoke abc   Revoke device with ID "abc"
`);
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
