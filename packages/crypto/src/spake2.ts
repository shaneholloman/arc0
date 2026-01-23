/**
 * SPAKE2 implementation using Ed25519 curve.
 *
 * SPAKE2 is a Password-Authenticated Key Exchange (PAKE) protocol that allows
 * two parties to derive a shared secret from a weak password, without revealing
 * the password to an eavesdropper or man-in-the-middle attacker.
 *
 * Protocol overview:
 * 1. Both parties agree on a password (the pairing code)
 * 2. Client computes X = g^x * M^pw and sends to server
 * 3. Server computes Y = g^y * N^pw and sends to client
 * 4. Both derive shared secret K = (peer_msg / Peer_M^pw)^my_scalar
 * 5. Both compute MAC over transcript to confirm no MITM
 */

import { ed25519 } from "@noble/curves/ed25519";
import { sha256 } from "@noble/hashes/sha256";
import { hmac } from "@noble/hashes/hmac";
import { randomBytes } from "@noble/ciphers/webcrypto";
import { bytesToHex, hexToBytes, utf8ToBytes, concatBytes } from "@noble/hashes/utils";

// Ed25519 parameters
const CURVE_ORDER = ed25519.CURVE.n;

/**
 * Fixed generator points M and N for SPAKE2.
 * These are derived deterministically from nothing-up-my-sleeve strings.
 * M is used by the client, N is used by the server.
 */
function hashToPoint(data: string): Uint8Array {
  // Hash the string and use it to create a valid curve point
  const hash = sha256(utf8ToBytes(data));
  // Use extended coordinates - multiply base point by hash as scalar
  const scalar = bytesToBigInt(hash) % CURVE_ORDER;
  return ed25519.ExtendedPoint.BASE.multiply(scalar).toRawBytes();
}

// Nothing-up-my-sleeve constants for M and N
const M_SEED = "arc0-spake2-M-v1";
const N_SEED = "arc0-spake2-N-v1";
const M_POINT = hashToPoint(M_SEED);
const N_POINT = hashToPoint(N_SEED);

function bytesToBigInt(bytes: Uint8Array): bigint {
  let result = 0n;
  for (const byte of bytes) {
    result = (result << 8n) + BigInt(byte);
  }
  return result;
}

function bigIntToBytes(n: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    bytes[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return bytes;
}

/**
 * Hash password to a scalar in the curve's field.
 */
function hashPassword(password: string): bigint {
  const hash = sha256(utf8ToBytes(`arc0-spake2-pw:${password}`));
  return bytesToBigInt(hash) % CURVE_ORDER;
}

/**
 * Compute point multiplication: point * scalar
 */
function pointMultiply(point: Uint8Array, scalar: bigint): Uint8Array {
  const p = ed25519.ExtendedPoint.fromHex(point);
  return p.multiply(scalar).toRawBytes();
}

/**
 * Add two curve points.
 */
function pointAdd(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const point1 = ed25519.ExtendedPoint.fromHex(p1);
  const point2 = ed25519.ExtendedPoint.fromHex(p2);
  return point1.add(point2).toRawBytes();
}

/**
 * Subtract two curve points (p1 - p2).
 */
function pointSubtract(p1: Uint8Array, p2: Uint8Array): Uint8Array {
  const point1 = ed25519.ExtendedPoint.fromHex(p1);
  const point2 = ed25519.ExtendedPoint.fromHex(p2);
  return point1.subtract(point2).toRawBytes();
}

export type Spake2Role = "client" | "server";

export interface Spake2State {
  role: Spake2Role;
  password: string;
  privateScalar: bigint;
  publicMessage: Uint8Array;
  transcript: Uint8Array[];
}

export interface Spake2KeyMaterial {
  sharedSecret: Uint8Array;
  transcript: Uint8Array;
}

/**
 * Initialize SPAKE2 protocol for either client or server.
 *
 * @param role - "client" or "server"
 * @param password - The shared password (pairing code)
 * @returns State containing the public message to send to peer
 */
export function spake2Init(role: Spake2Role, password: string): Spake2State {
  // Generate random private scalar
  const privateBytes = randomBytes(32);
  const privateScalar = bytesToBigInt(privateBytes) % CURVE_ORDER;

  // Compute g^scalar (our public key before masking)
  const publicPoint = ed25519.ExtendedPoint.BASE.multiply(privateScalar).toRawBytes();

  // Hash password to scalar
  const pwScalar = hashPassword(password);

  // Mask with M (client) or N (server)
  // Client: X = g^x * M^pw
  // Server: Y = g^y * N^pw
  const maskPoint = role === "client" ? M_POINT : N_POINT;
  const maskedPoint = pointMultiply(maskPoint, pwScalar);
  const publicMessage = pointAdd(publicPoint, maskedPoint);

  return {
    role,
    password,
    privateScalar,
    publicMessage,
    transcript: [],
  };
}

/**
 * Process peer's message and derive shared secret.
 *
 * @param state - Our SPAKE2 state
 * @param peerMessage - The peer's public message
 * @returns Key material containing shared secret and transcript
 */
export function spake2Finish(
  state: Spake2State,
  peerMessage: Uint8Array
): Spake2KeyMaterial {
  const { role, password, privateScalar, publicMessage } = state;

  // Hash password to scalar
  const pwScalar = hashPassword(password);

  // Remove mask from peer's message
  // If we're client, peer used N; if we're server, peer used M
  const peerMaskPoint = role === "client" ? N_POINT : M_POINT;
  const maskedPoint = pointMultiply(peerMaskPoint, pwScalar);
  const peerPublicKey = pointSubtract(peerMessage, maskedPoint);

  // Compute shared secret: peer_public_key ^ my_private_scalar
  const sharedPoint = pointMultiply(peerPublicKey, privateScalar);

  // Build transcript: role || my_message || peer_message || shared_point
  // Order: client message first, then server message
  const clientMessage = role === "client" ? publicMessage : peerMessage;
  const serverMessage = role === "server" ? publicMessage : peerMessage;

  const transcript = concatBytes(
    utf8ToBytes("arc0-spake2-v1"),
    clientMessage,
    serverMessage,
    sharedPoint
  );

  // Hash transcript to get shared secret
  const sharedSecret = sha256(transcript);

  return {
    sharedSecret,
    transcript,
  };
}

/**
 * Compute confirmation MAC to verify no MITM attack.
 *
 * @param keyMaterial - The key material from spake2Finish
 * @param role - Our role (client or server)
 * @returns MAC to send to peer for verification
 */
export function spake2ComputeConfirmation(
  keyMaterial: Spake2KeyMaterial,
  role: Spake2Role
): Uint8Array {
  const prefix = role === "client" ? "client-confirm" : "server-confirm";
  return hmac(sha256, keyMaterial.sharedSecret, utf8ToBytes(prefix));
}

/**
 * Verify peer's confirmation MAC.
 *
 * @param keyMaterial - The key material from spake2Finish
 * @param peerRole - The peer's role
 * @param peerMac - The MAC received from peer
 * @returns true if MAC is valid
 */
export function spake2VerifyConfirmation(
  keyMaterial: Spake2KeyMaterial,
  peerRole: Spake2Role,
  peerMac: Uint8Array
): boolean {
  const expectedMac = spake2ComputeConfirmation(keyMaterial, peerRole);

  // Constant-time comparison
  if (expectedMac.length !== peerMac.length) {
    return false;
  }

  let diff = 0;
  for (let i = 0; i < expectedMac.length; i++) {
    diff |= expectedMac[i]! ^ peerMac[i]!;
  }
  return diff === 0;
}

// Re-export utilities for use in higher-level code
export { bytesToHex, hexToBytes, randomBytes };
