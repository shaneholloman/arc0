/**
 * Server-side encryption layer for Socket.IO.
 *
 * Handles encryption/decryption of messages for each connected client.
 */

import {
  encrypt,
  decrypt,
  isEncryptedEnvelope,
  base64ToUint8Array,
  type EncryptedEnvelope,
} from "@arc0/crypto";

/**
 * Per-client encryption context.
 */
export interface ClientEncryptionContext {
  deviceId: string;
  /** Raw encryption key bytes */
  encryptionKey: Uint8Array;
}

// Active encryption contexts by socket ID
const encryptionContexts = new Map<string, ClientEncryptionContext>();

/**
 * Register an encryption context for a client.
 */
export function registerEncryptionContext(
  socketId: string,
  deviceId: string,
  encryptionKey: Uint8Array
): void {
  encryptionContexts.set(socketId, { deviceId, encryptionKey });
  console.log(`[encryption] Registered context for socket ${socketId}`);
}

/**
 * Remove encryption context when client disconnects.
 */
export function removeEncryptionContext(socketId: string): void {
  encryptionContexts.delete(socketId);
}

/**
 * Check if a client has an encryption context.
 */
export function hasEncryptionContext(socketId: string): boolean {
  return encryptionContexts.has(socketId);
}

/**
 * Get encryption context for a socket.
 */
export function getEncryptionContext(socketId: string): ClientEncryptionContext | null {
  return encryptionContexts.get(socketId) ?? null;
}

/**
 * Encrypt a payload for a specific client.
 */
export function encryptForClient<T>(socketId: string, payload: T): EncryptedEnvelope | null {
  const ctx = encryptionContexts.get(socketId);
  if (!ctx) {
    console.warn(`[encryption] No context for socket ${socketId}`);
    return null;
  }
  return encrypt(ctx.encryptionKey, payload);
}

/**
 * Decrypt a payload from a specific client.
 */
export function decryptFromClient<T>(socketId: string, envelope: EncryptedEnvelope): T | null {
  const ctx = encryptionContexts.get(socketId);
  if (!ctx) {
    console.warn(`[encryption] No context for socket ${socketId}`);
    return null;
  }
  try {
    return decrypt<T>(ctx.encryptionKey, envelope);
  } catch (err) {
    console.error(`[encryption] Decryption failed for socket ${socketId}:`, err);
    return null;
  }
}

/**
 * Check if a value looks like an encrypted envelope.
 */
export { isEncryptedEnvelope };
