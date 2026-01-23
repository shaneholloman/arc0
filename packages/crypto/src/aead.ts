/**
 * AEAD encryption using XChaCha20-Poly1305.
 *
 * XChaCha20-Poly1305 provides authenticated encryption with a 256-bit key
 * and 192-bit nonce. The larger nonce size makes it safe to use random nonces
 * without worrying about collisions.
 */

import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { bytesToHex, hexToBytes, utf8ToBytes } from "@noble/hashes/utils";

// XChaCha20 uses 24-byte nonces
const NONCE_LENGTH = 24;

// Poly1305 tag is 16 bytes
const TAG_LENGTH = 16;

/**
 * Encrypted envelope for transport.
 */
export interface EncryptedEnvelope {
  /** Protocol version */
  v: 1;
  /** 24-byte nonce, base64 encoded */
  nonce: string;
  /** Ciphertext + Poly1305 tag, base64 encoded */
  ciphertext: string;
}

/**
 * Encrypt a JSON-serializable payload.
 *
 * @param key - 32-byte encryption key
 * @param payload - Object to encrypt (will be JSON-serialized)
 * @returns Encrypted envelope ready for transport
 */
export function encrypt<T>(key: Uint8Array, payload: T): EncryptedEnvelope {
  if (key.length !== 32) {
    throw new Error("Key must be 32 bytes");
  }

  // Serialize payload to JSON bytes
  const plaintext = utf8ToBytes(JSON.stringify(payload));

  // Generate random nonce
  const nonce = randomBytes(NONCE_LENGTH);

  // Encrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(key, nonce);
  const ciphertext = cipher.encrypt(plaintext);

  return {
    v: 1,
    nonce: uint8ArrayToBase64(nonce),
    ciphertext: uint8ArrayToBase64(ciphertext),
  };
}

/**
 * Decrypt an encrypted envelope.
 *
 * @param key - 32-byte encryption key
 * @param envelope - Encrypted envelope from transport
 * @returns Decrypted and parsed JSON payload
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export function decrypt<T>(key: Uint8Array, envelope: EncryptedEnvelope): T {
  if (key.length !== 32) {
    throw new Error("Key must be 32 bytes");
  }

  if (envelope.v !== 1) {
    throw new Error(`Unsupported envelope version: ${envelope.v}`);
  }

  // Decode base64
  const nonce = base64ToUint8Array(envelope.nonce);
  const ciphertext = base64ToUint8Array(envelope.ciphertext);

  if (nonce.length !== NONCE_LENGTH) {
    throw new Error(`Invalid nonce length: ${nonce.length}`);
  }

  if (ciphertext.length < TAG_LENGTH) {
    throw new Error("Ciphertext too short");
  }

  // Decrypt with XChaCha20-Poly1305
  const cipher = xchacha20poly1305(key, nonce);
  const plaintext = cipher.decrypt(ciphertext);

  // Parse JSON
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as T;
}

/**
 * Check if an object looks like an encrypted envelope.
 */
export function isEncryptedEnvelope(obj: unknown): obj is EncryptedEnvelope {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "v" in obj &&
    obj.v === 1 &&
    "nonce" in obj &&
    typeof (obj as EncryptedEnvelope).nonce === "string" &&
    "ciphertext" in obj &&
    typeof (obj as EncryptedEnvelope).ciphertext === "string"
  );
}

// Base64 utilities (work in both Node.js and browser)

function uint8ArrayToBase64(bytes: Uint8Array): string {
  // Use built-in btoa in browser, Buffer in Node.js
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Use built-in atob in browser, Buffer in Node.js
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// Re-export for convenience
export { uint8ArrayToBase64, base64ToUint8Array, randomBytes };
