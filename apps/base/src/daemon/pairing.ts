/**
 * Server-side pairing handler using SPAKE2.
 *
 * Manages active pairing sessions, SPAKE2 key exchange, and key derivation.
 */

import { hostname } from "node:os";
import {
  spake2Init,
  spake2Finish,
  spake2ComputeConfirmation,
  spake2VerifyConfirmation,
  deriveKeys,
  bytesToHex,
  hexToBytes,
  generatePairingCode,
  formatPairingCode,
  uint8ArrayToBase64,
  type Spake2State,
  type Spake2KeyMaterial,
} from "@arc0/crypto";
import type {
  PairInitPayload,
  PairChallengePayload,
  PairCompletePayload,
  PairErrorPayload,
} from "@arc0/types";
import { addClient } from "../shared/clients.js";
import { loadConfig } from "../shared/config.js";

// Pairing session expires after 5 minutes
const PAIRING_TIMEOUT_MS = 5 * 60 * 1000;

export interface PairingSession {
  code: string;
  state: Spake2State | null;
  keyMaterial: Spake2KeyMaterial | null;
  createdAt: Date;
  deviceId?: string;
  deviceName?: string;
  expiresAt: Date;
}

export interface PairingResult {
  authToken: Uint8Array;
  encryptionKey: Uint8Array;
  deviceId: string;
  deviceName: string;
}

/**
 * Manages pairing sessions for the daemon.
 */
export class PairingManager {
  private session: PairingSession | null = null;
  private onPairingComplete?: (result: PairingResult) => void;

  /**
   * Start a new pairing session.
   *
   * @returns The pairing code to display to the user
   */
  startPairing(): { code: string; formattedCode: string } {
    const code = generatePairingCode();
    const now = new Date();

    this.session = {
      code,
      state: null,
      keyMaterial: null,
      createdAt: now,
      expiresAt: new Date(now.getTime() + PAIRING_TIMEOUT_MS),
    };

    // Set up expiration timer
    setTimeout(() => {
      if (this.session?.code === code) {
        this.cancelPairing();
      }
    }, PAIRING_TIMEOUT_MS);

    return {
      code,
      formattedCode: formatPairingCode(code),
    };
  }

  /**
   * Check if there's an active pairing session.
   */
  isPairingActive(): boolean {
    return this.session !== null && this.session.expiresAt > new Date();
  }

  /**
   * Cancel the current pairing session.
   */
  cancelPairing(): void {
    this.session = null;
  }

  /**
   * Set callback for when pairing completes successfully.
   */
  onComplete(callback: (result: PairingResult) => void): void {
    this.onPairingComplete = callback;
  }

  /**
   * Handle pair:init from client.
   *
   * @param payload - Client's SPAKE2 init message
   * @returns Challenge payload to send back, or error
   */
  handlePairInit(
    payload: PairInitPayload
  ): { challenge: PairChallengePayload } | { error: PairErrorPayload } {
    if (!this.session || this.session.expiresAt < new Date()) {
      return {
        error: {
          code: "PAIRING_DISABLED",
          message: "No active pairing session. Run 'arc0 pair' first.",
        },
      };
    }

    // Initialize SPAKE2 with the pairing code as password
    const state = spake2Init("server", this.session.code);

    // Parse client's SPAKE2 message
    let clientMessage: Uint8Array;
    try {
      clientMessage = hexToBytes(payload.spake2Message);
    } catch (e) {
      return {
        error: { code: "INVALID_FORMAT", message: "Invalid spake2Message format" },
      };
    }

    // Complete the SPAKE2 exchange
    const keyMaterial = spake2Finish(state, clientMessage);

    // Store state for confirmation step
    this.session.state = state;
    this.session.keyMaterial = keyMaterial;
    this.session.deviceId = payload.deviceId;
    this.session.deviceName = payload.deviceName;

    return {
      challenge: {
        spake2Message: bytesToHex(state.publicMessage),
      },
    };
  }

  /**
   * Handle pair:confirm from client.
   *
   * @param mac - Client's confirmation MAC
   * @returns Complete payload to send back, or error
   */
  handlePairConfirm(
    mac: string
  ): { complete: PairCompletePayload } | { error: PairErrorPayload } {
    if (!this.session || !this.session.keyMaterial) {
      return {
        error: {
          code: "PAIRING_DISABLED",
          message: "No active pairing session.",
        },
      };
    }

    // Verify client's MAC
    let clientMac: Uint8Array;
    try {
      clientMac = hexToBytes(mac);
    } catch (e) {
      return {
        error: { code: "INVALID_FORMAT", message: "Invalid MAC format" },
      };
    }
    const isValid = spake2VerifyConfirmation(
      this.session.keyMaterial,
      "client",
      clientMac
    );

    if (!isValid) {
      return {
        error: {
          code: "MAC_MISMATCH",
          message: "Invalid confirmation. The pairing code may be incorrect.",
        },
      };
    }

    // Compute our confirmation MAC
    const serverMac = spake2ComputeConfirmation(
      this.session.keyMaterial,
      "server"
    );

    // Derive keys
    const { authToken, encryptionKey } = deriveKeys(
      this.session.keyMaterial.sharedSecret,
      this.session.keyMaterial.transcript
    );

    // Store the client with encryption key
    const deviceId = this.session.deviceId!;
    const deviceName = this.session.deviceName!;
    addClient(deviceId, authToken, encryptionKey, deviceName);

    // Get workstation info
    const config = loadConfig();
    const workstationId = config?.workstationId ?? "unknown";
    const workstationName = getWorkstationName();

    // Notify completion callback
    if (this.onPairingComplete) {
      this.onPairingComplete({
        authToken,
        encryptionKey,
        deviceId,
        deviceName,
      });
    }

    // Clear session
    const result: PairCompletePayload = {
      mac: bytesToHex(serverMac),
      workstationId,
      workstationName,
    };

    this.session = null;

    return { complete: result };
  }

  /**
   * Get the current pairing code if active.
   */
  getActiveCode(): string | null {
    if (this.session && this.session.expiresAt > new Date()) {
      return this.session.code;
    }
    return null;
  }

  /**
   * Get remaining time for the pairing session.
   */
  getRemainingTime(): number {
    if (!this.session) return 0;
    return Math.max(0, this.session.expiresAt.getTime() - Date.now());
  }
}

/**
 * Get a friendly name for this workstation.
 */
function getWorkstationName(): string {
  const host = process.env.HOSTNAME ?? hostname();
  const user = process.env.USER ?? process.env.USERNAME ?? "user";
  return `${user}@${host}`;
}

// Singleton instance
export const pairingManager = new PairingManager();
