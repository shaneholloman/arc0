/**
 * @arc0/crypto - Cryptographic primitives for E2E encryption
 *
 * This package provides:
 * - SPAKE2: Password-authenticated key exchange for device pairing
 * - AEAD: XChaCha20-Poly1305 authenticated encryption
 * - KDF: HKDF-SHA256 key derivation
 * - Device codes: Pairing code generation and validation
 */

// SPAKE2 PAKE protocol
export {
  spake2Init,
  spake2Finish,
  spake2ComputeConfirmation,
  spake2VerifyConfirmation,
  bytesToHex,
  hexToBytes,
  type Spake2Role,
  type Spake2State,
  type Spake2KeyMaterial,
} from "./spake2";

// AEAD encryption
export {
  encrypt,
  decrypt,
  isEncryptedEnvelope,
  uint8ArrayToBase64,
  base64ToUint8Array,
  randomBytes,
  type EncryptedEnvelope,
} from "./aead";

// Key derivation
export { deriveKeys, deriveKey, type DerivedKeys } from "./kdf";

// Device pairing codes
export {
  generatePairingCode,
  formatPairingCode,
  parsePairingCode,
  isValidPairingCode,
} from "./device-code";

// Utility: hash for token storage
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
import { randomBytes as _randomBytes } from "@noble/ciphers/webcrypto";

/**
 * Hash an auth token for storage (don't store tokens in plaintext).
 */
export function hashAuthToken(token: Uint8Array): string {
  return bytesToHex(sha256(token));
}

/**
 * Generate a unique device ID.
 */
export function generateDeviceId(): string {
  const bytes = _randomBytes(16);
  const hex = bytesToHex(bytes);
  // Format as UUID-like: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
