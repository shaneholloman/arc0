/**
 * Client-side pairing protocol using SPAKE2.
 *
 * Handles the pairing flow when adding a new workstation:
 * 1. User enters pairing code from CLI
 * 2. Connect to workstation (unauthenticated)
 * 3. Perform SPAKE2 key exchange
 * 4. Derive and store auth token + encryption key
 */

import { io, Socket } from 'socket.io-client';
import {
  spake2Init,
  spake2Finish,
  spake2ComputeConfirmation,
  spake2VerifyConfirmation,
  deriveKeys,
  bytesToHex,
  hexToBytes,
  parsePairingCode,
  uint8ArrayToBase64,
  generateDeviceId,
} from '@arc0/crypto';
import type {
  PairChallengePayload,
  PairCompletePayload,
  PairErrorPayload,
} from '@arc0/types';
import { getDeviceName } from '../device';

// Pairing timeout (same as server)
const PAIRING_TIMEOUT_MS = 30_000;

export interface PairingResult {
  /** Workstation ID from server */
  workstationId: string;
  /** Workstation name for display */
  workstationName: string;
  /** Auth token for future connections (base64) */
  authToken: string;
  /** Encryption key for E2E encryption (base64) */
  encryptionKey: string;
  /** Device ID used for this pairing */
  deviceId: string;
}

export interface PairingError {
  code: string;
  message: string;
}

/**
 * Perform pairing with a workstation.
 *
 * @param url - Workstation Socket.IO URL
 * @param pairingCode - The 8-character code from CLI (can include dashes)
 * @param deviceId - Device ID (optional, will be generated if not provided)
 * @returns Pairing result with credentials, or throws error
 */
export async function pairWithWorkstation(
  url: string,
  pairingCode: string,
  deviceId?: string
): Promise<PairingResult> {
  // Parse and validate the pairing code
  const normalizedCode = parsePairingCode(pairingCode);
  if (!normalizedCode) {
    throw new Error('Invalid pairing code format');
  }

  // Generate or use provided device ID
  const finalDeviceId = deviceId ?? generateDeviceId();
  const deviceName = await getDeviceName();

  return new Promise((resolve, reject) => {
    let socket: Socket | null = null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (socket) {
        socket.removeAllListeners();
        socket.close();
        socket = null;
      }
    };

    const handleError = (error: PairingError | string) => {
      cleanup();
      const message = typeof error === 'string' ? error : error.message;
      reject(new Error(message));
    };

    // Set timeout
    timeoutId = setTimeout(() => {
      handleError('Pairing timeout - please try again');
    }, PAIRING_TIMEOUT_MS);

    // Connect without authentication for pairing
    socket = io(url, {
      autoConnect: true,
      reconnection: false,
      transports: ['websocket'],
      timeout: 10_000,
    });

    socket.on('connect_error', (err) => {
      handleError(`Connection failed: ${err.message}`);
    });

    socket.on('connect', () => {
      console.log('[Pairing] Connected, starting SPAKE2...');

      // Initialize SPAKE2 with pairing code
      const state = spake2Init('client', normalizedCode);

      // Send pair:init with our public message
      socket!.emit('pair:init', {
        deviceId: finalDeviceId,
        deviceName,
        spake2Message: bytesToHex(state.publicMessage),
      });

      // Wait for challenge
      socket!.once('pair:challenge', (challenge: PairChallengePayload) => {
        console.log('[Pairing] Received challenge, computing shared secret...');

        try {
          // Complete SPAKE2 with server's message
          const serverMessage = hexToBytes(challenge.spake2Message);
          const keyMaterial = spake2Finish(state, serverMessage);

          // Compute our confirmation MAC
          const clientMac = spake2ComputeConfirmation(keyMaterial, 'client');

          // Send confirmation
          socket!.emit('pair:confirm', {
            mac: bytesToHex(clientMac),
          });

          // Wait for server's confirmation
          socket!.once('pair:complete', (complete: PairCompletePayload) => {
            console.log('[Pairing] Received completion, verifying...');

            try {
              // Verify server's MAC
              const serverMac = hexToBytes(complete.mac);
              const isValid = spake2VerifyConfirmation(
                keyMaterial,
                'server',
                serverMac
              );

              if (!isValid) {
                handleError('Server verification failed - possible MITM attack');
                return;
              }

              // Derive keys
              const { authToken, encryptionKey } = deriveKeys(
                keyMaterial.sharedSecret,
                keyMaterial.transcript
              );

              cleanup();

              console.log('[Pairing] Success!');
              resolve({
                workstationId: complete.workstationId,
                workstationName: complete.workstationName,
                authToken: uint8ArrayToBase64(authToken),
                encryptionKey: uint8ArrayToBase64(encryptionKey),
                deviceId: finalDeviceId,
              });
            } catch (err) {
              handleError(`Verification error: ${err}`);
            }
          });
        } catch (err) {
          handleError(`SPAKE2 error: ${err}`);
        }
      });
    });

    // Handle errors from server
    socket.on('pair:error', (error: PairErrorPayload) => {
      console.log(`[Pairing] Error: ${error.code} - ${error.message}`);
      handleError(error);
    });
  });
}
