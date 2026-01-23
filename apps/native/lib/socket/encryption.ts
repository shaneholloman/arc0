/**
 * Socket message encryption/decryption layer.
 *
 * Provides E2E encryption for all sensitive Socket.IO payloads
 * using XChaCha20-Poly1305.
 */

import {
  encrypt as aeadEncrypt,
  decrypt as aeadDecrypt,
  isEncryptedEnvelope,
  base64ToUint8Array,
  type EncryptedEnvelope,
} from '@arc0/crypto';

/**
 * Encryption context for a workstation connection.
 */
export interface EncryptionContext {
  /** Base64-encoded encryption key */
  encryptionKey: string;
}

// Cache decoded keys to avoid repeated decoding
const keyCache = new Map<string, Uint8Array>();

function getKeyBytes(base64Key: string): Uint8Array {
  let key = keyCache.get(base64Key);
  if (!key) {
    key = base64ToUint8Array(base64Key);
    keyCache.set(base64Key, key);
  }
  return key;
}

/**
 * Encrypt a payload for sending over the socket.
 *
 * @param ctx - Encryption context with the key
 * @param payload - JSON-serializable payload
 * @returns Encrypted envelope
 */
export function encryptPayload<T>(
  ctx: EncryptionContext,
  payload: T
): EncryptedEnvelope {
  const key = getKeyBytes(ctx.encryptionKey);
  return aeadEncrypt(key, payload);
}

/**
 * Decrypt an encrypted envelope received from the socket.
 *
 * @param ctx - Encryption context with the key
 * @param envelope - Encrypted envelope
 * @returns Decrypted payload
 * @throws Error if decryption fails
 */
export function decryptPayload<T>(
  ctx: EncryptionContext,
  envelope: EncryptedEnvelope
): T {
  const key = getKeyBytes(ctx.encryptionKey);
  return aeadDecrypt(key, envelope);
}

/**
 * Check if a value is an encrypted envelope.
 */
export { isEncryptedEnvelope };

/**
 * Clear the key cache (call when disconnecting).
 */
export function clearKeyCache(base64Key?: string): void {
  if (base64Key) {
    keyCache.delete(base64Key);
  } else {
    keyCache.clear();
  }
}
