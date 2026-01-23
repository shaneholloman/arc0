/**
 * Device pairing code generation and validation.
 *
 * The pairing code is an 8-character string from an unambiguous alphabet,
 * displayed as XXXX-XXXX for readability.
 */

import { randomBytes } from "@noble/ciphers/webcrypto";

// Unambiguous alphabet: no 0/O/1/I/L
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 8;

// 5 bits per character, 8 characters = 40 bits of entropy
const BITS_PER_CHAR = 5;

/**
 * Generate a random pairing code.
 *
 * @returns 8-character code from unambiguous alphabet
 */
export function generatePairingCode(): string {
  // Generate enough random bytes (5 bytes = 40 bits = 8 chars)
  const bytes = randomBytes(5);

  // Extract 5-bit chunks
  let bits = 0n;
  for (const byte of bytes) {
    bits = (bits << 8n) | BigInt(byte);
  }

  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    const index = Number((bits >> BigInt((CODE_LENGTH - 1 - i) * BITS_PER_CHAR)) & 0x1fn);
    code += CODE_ALPHABET[index];
  }

  return code;
}

/**
 * Format a pairing code for display (XXXX-XXXX).
 */
export function formatPairingCode(code: string): string {
  if (code.length !== CODE_LENGTH) {
    throw new Error(`Invalid code length: ${code.length}`);
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Parse a pairing code from user input.
 * Removes dashes/spaces and converts to uppercase.
 *
 * @param input - User-entered code
 * @returns Normalized 8-character code, or null if invalid
 */
export function parsePairingCode(input: string): string | null {
  // Remove dashes, spaces, and convert to uppercase
  const normalized = input.replace(/[-\s]/g, "").toUpperCase();

  if (normalized.length !== CODE_LENGTH) {
    return null;
  }

  // Validate all characters are in alphabet
  for (const char of normalized) {
    if (!CODE_ALPHABET.includes(char)) {
      return null;
    }
  }

  return normalized;
}

/**
 * Validate that a string is a valid pairing code.
 */
export function isValidPairingCode(code: string): boolean {
  return parsePairingCode(code) !== null;
}
