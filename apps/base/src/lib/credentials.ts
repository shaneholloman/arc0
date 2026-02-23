import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { CREDENTIALS_FILE } from "./config.js";

export interface Credentials {
  encryptionKey: string;
  createdAt: string;
  // Arc0 tunnel auth (from better-auth device flow)
  bearerToken?: string;
  userId?: string;
}

/**
 * Load credentials from disk.
 */
export function loadCredentials(): Credentials | null {
  if (!existsSync(CREDENTIALS_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CREDENTIALS_FILE, "utf-8"));
  } catch {
    return null;
  }
}

/**
 * Ensure credentials exist, creating them if necessary.
 */
export function ensureCredentials(): Credentials {
  let creds = loadCredentials();
  if (!creds) {
    creds = {
      encryptionKey: randomBytes(32).toString("hex"),
      createdAt: new Date().toISOString(),
    };
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
      mode: 0o600,
    });
    console.log(
      `[credentials] Generated new credentials in ${CREDENTIALS_FILE}`,
    );
  }
  return creds;
}

/**
 * Update credentials with tunnel auth info.
 */
export function updateTunnelAuth(
  bearerToken: string,
  userId: string,
): Credentials {
  const creds = ensureCredentials();
  creds.bearerToken = bearerToken;
  creds.userId = userId;
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
    mode: 0o600,
  });
  console.log(`[credentials] Updated tunnel auth for user ${userId}`);
  return creds;
}

/**
 * Clear tunnel auth info.
 */
export function clearTunnelAuth(): void {
  const creds = loadCredentials();
  if (creds) {
    delete creds.bearerToken;
    delete creds.userId;
    writeFileSync(CREDENTIALS_FILE, JSON.stringify(creds, null, 2), {
      mode: 0o600,
    });
    console.log(`[credentials] Cleared tunnel auth`);
  }
}
