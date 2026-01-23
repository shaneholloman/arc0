/**
 * Key Derivation using HKDF-SHA256.
 *
 * HKDF (HMAC-based Key Derivation Function) is used to derive multiple
 * keys from the SPAKE2 shared secret:
 * - authToken: Used for Socket.IO authentication
 * - encryptionKey: Used for message encryption
 */

import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { utf8ToBytes } from "@noble/hashes/utils";

// Key lengths
const AUTH_TOKEN_LENGTH = 32;
const ENCRYPTION_KEY_LENGTH = 32;

// Info strings for domain separation
const AUTH_TOKEN_INFO = "arc0-auth-v1";
const ENCRYPTION_KEY_INFO = "arc0-encrypt-v1";

export interface DerivedKeys {
  /** 32-byte auth token for Socket.IO authentication */
  authToken: Uint8Array;
  /** 32-byte key for XChaCha20-Poly1305 encryption */
  encryptionKey: Uint8Array;
}

/**
 * Derive authentication and encryption keys from SPAKE2 shared secret.
 *
 * @param sharedSecret - The shared secret from SPAKE2 key exchange
 * @param transcript - The SPAKE2 protocol transcript (used as salt)
 * @returns Derived keys for authentication and encryption
 */
export function deriveKeys(
  sharedSecret: Uint8Array,
  transcript: Uint8Array
): DerivedKeys {
  // Use transcript hash as salt for domain separation
  const salt = sha256(transcript);

  // Derive auth token
  const authToken = hkdf(
    sha256,
    sharedSecret,
    salt,
    utf8ToBytes(AUTH_TOKEN_INFO),
    AUTH_TOKEN_LENGTH
  );

  // Derive encryption key
  const encryptionKey = hkdf(
    sha256,
    sharedSecret,
    salt,
    utf8ToBytes(ENCRYPTION_KEY_INFO),
    ENCRYPTION_KEY_LENGTH
  );

  return {
    authToken,
    encryptionKey,
  };
}

/**
 * Derive a single key with custom info string.
 *
 * @param sharedSecret - The input key material
 * @param salt - Salt for HKDF (can be empty)
 * @param info - Context/application-specific info string
 * @param length - Desired output length in bytes
 * @returns Derived key
 */
export function deriveKey(
  sharedSecret: Uint8Array,
  salt: Uint8Array,
  info: string,
  length: number
): Uint8Array {
  return hkdf(sha256, sharedSecret, salt, utf8ToBytes(info), length);
}
