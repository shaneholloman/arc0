/**
 * Per-client token storage.
 *
 * Stores hashed auth tokens for each paired device, allowing individual
 * device revocation and audit logging.
 */

import { timingSafeEqual } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { base64ToUint8Array, hashAuthToken } from "@arc0/crypto";
import { CONFIG_DIR } from "./config.js";

export const CLIENTS_FILE = join(CONFIG_DIR, "clients.json");

export interface ClientRecord {
  /** SHA-256 hash of the authToken */
  authTokenHash: string;
  /** Encryption key for E2E encryption (base64) */
  encryptionKey?: string;
  /** When the client was paired */
  createdAt: string;
  /** Last time client connected */
  lastSeen?: string;
  /** User-friendly device name */
  deviceName?: string;
}

export interface ClientStore {
  clients: {
    [deviceId: string]: ClientRecord;
  };
}

/**
 * Load the client store from disk.
 */
export function loadClientStore(): ClientStore {
  if (!existsSync(CLIENTS_FILE)) {
    return { clients: {} };
  }
  try {
    return JSON.parse(readFileSync(CLIENTS_FILE, "utf-8"));
  } catch {
    return { clients: {} };
  }
}

/**
 * Save the client store to disk.
 */
function saveClientStore(store: ClientStore): void {
  writeFileSync(CLIENTS_FILE, JSON.stringify(store, null, 2), { mode: 0o600 });
}


/**
 * Add or update a client.
 *
 * @param deviceId - Unique device identifier
 * @param authToken - The raw auth token (will be hashed before storage)
 * @param encryptionKey - The encryption key
 * @param deviceName - Optional human-readable name
 */
export function addClient(
  deviceId: string,
  authToken: Uint8Array,
  encryptionKey?: Uint8Array,
  deviceName?: string
): void {
  const store = loadClientStore();

  const authTokenHash = hashAuthToken(authToken);

  const encKeyBase64 = encryptionKey
    ? Buffer.from(encryptionKey).toString("base64")
    : undefined;

  store.clients[deviceId] = {
    authTokenHash,
    encryptionKey: encKeyBase64,
    createdAt: new Date().toISOString(),
    deviceName,
  };

  saveClientStore(store);
  console.log(`[clients] Added client: ${deviceId}${deviceName ? ` (${deviceName})` : ""}`);
}

/**
 * Validate a client's auth token.
 *
 * @param deviceId - Device identifier
 * @param authToken - Base64-encoded auth token to validate
 * @returns true if token matches, false otherwise
 */
export function validateClient(deviceId: string, authToken: string): boolean {
  const store = loadClientStore();
  const client = store.clients[deviceId];

  if (!client) {
    return false;
  }

  const providedHash = hashAuthToken(base64ToUint8Array(authToken));

  // Timing-safe comparison of hashes
  const expected = Buffer.from(client.authTokenHash, "hex");
  const actual = Buffer.from(providedHash, "hex");

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

/**
 * Update the last-seen timestamp for a client.
 *
 * @param deviceId - Device identifier
 */
export function touchClient(deviceId: string): void {
  const store = loadClientStore();
  const client = store.clients[deviceId];

  if (client) {
    client.lastSeen = new Date().toISOString();
    saveClientStore(store);
  }
}

/**
 * Revoke a client's access.
 *
 * @param deviceId - Device identifier to revoke
 * @returns true if client was found and revoked
 */
export function revokeClient(deviceId: string): boolean {
  const store = loadClientStore();

  if (!store.clients[deviceId]) {
    return false;
  }

  const clientName = store.clients[deviceId].deviceName;
  delete store.clients[deviceId];
  saveClientStore(store);

  console.log(`[clients] Revoked client: ${deviceId}${clientName ? ` (${clientName})` : ""}`);
  return true;
}

/**
 * List all registered clients.
 */
export function listClients(): Array<{ deviceId: string } & ClientRecord> {
  const store = loadClientStore();
  return Object.entries(store.clients).map(([deviceId, record]) => ({
    deviceId,
    ...record,
  }));
}

/**
 * Get a specific client record.
 */
export function getClient(deviceId: string): ClientRecord | null {
  const store = loadClientStore();
  return store.clients[deviceId] ?? null;
}

/**
 * Check if a device ID is registered.
 */
export function hasClient(deviceId: string): boolean {
  const store = loadClientStore();
  return deviceId in store.clients;
}

/**
 * Update client device name.
 */
export function updateClientName(deviceId: string, deviceName: string): boolean {
  const store = loadClientStore();
  const client = store.clients[deviceId];

  if (!client) {
    return false;
  }

  client.deviceName = deviceName;
  saveClientStore(store);
  return true;
}

/**
 * Clear all clients (for testing or reset).
 */
export function clearAllClients(): void {
  saveClientStore({ clients: {} });
  console.log("[clients] Cleared all clients");
}
