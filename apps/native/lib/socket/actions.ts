/**
 * Socket.IO action emitters for user actions.
 * Each action uses ack callbacks with 30s timeout for request-response.
 *
 * Actions are sent to the workstation that owns the session.
 * If the workstation connection has E2E encryption enabled, payloads are encrypted.
 */

import { randomUUID } from 'expo-crypto';
import type {
  ActionResult,
  ApproveToolUsePayload,
  EncryptedEnvelope,
  ModelId,
  OpenSessionPayload,
  PromptMode,
  ProviderId,
  SendPromptPayload,
  StopAgentPayload,
  ToolResponse,
} from '@arc0/types';
import { getSocketManager, type AppSocket } from './manager';
import { logEvent, type EventType } from './eventLogger';
import { encryptPayload, type EncryptionContext } from './encryption';

// =============================================================================
// Constants
// =============================================================================

const ACTION_TIMEOUT_MS = 30_000; // 30 seconds

// =============================================================================
// Error Types
// =============================================================================

export class ActionTimeoutError extends Error {
  constructor(eventName: string) {
    super(`Action '${eventName}' timed out after ${ACTION_TIMEOUT_MS}ms`);
    this.name = 'ActionTimeoutError';
  }
}

export class ActionDisconnectedError extends Error {
  constructor() {
    super('Socket disconnected - cannot send action');
    this.name = 'ActionDisconnectedError';
  }
}

export class ActionNoWorkstationError extends Error {
  constructor() {
    super('No active workstation - cannot send action');
    this.name = 'ActionNoWorkstationError';
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

// User action event names for typing
type UserActionEventName = 'openSession' | 'sendPrompt' | 'stopAgent' | 'approveToolUse';

interface SocketWithEncryption {
  socket: AppSocket;
  encryptionCtx?: EncryptionContext;
}

/**
 * Get a connected socket for sending actions.
 * For session-specific actions, looks up the session's workstation.
 * For new sessions, uses the active workstation.
 *
 * @param workstationId - The workstation ID to get socket for
 */
function getSocketForAction(workstationId: string): SocketWithEncryption {
  const manager = getSocketManager();

  if (!manager.isConnected(workstationId)) {
    throw new ActionDisconnectedError();
  }

  const socket = manager.getSocket(workstationId);
  if (!socket) {
    throw new ActionDisconnectedError();
  }

  // Get encryption context if available
  const encryptionCtx = manager.getEncryptionContext(workstationId);

  return { socket, encryptionCtx };
}

/**
 * Emit a Socket.IO event with ack callback and timeout.
 * Encrypts the payload if encryption context is provided.
 *
 * @param socketInfo - Socket and optional encryption context
 * @param eventName - The event name to emit
 * @param payload - The payload to send
 * @returns Promise that resolves with the ActionResult
 */
function emitWithAck<T extends Record<string, unknown>>(
  socketInfo: SocketWithEncryption,
  eventName: UserActionEventName,
  payload: T
): Promise<ActionResult> {
  return new Promise((resolve, reject) => {
    logEvent(
      eventName as EventType,
      'out',
      `Sending ${eventName}`,
      payload as Record<string, unknown>
    );

    // Encrypt payload if encryption is available
    const payloadToSend: T | EncryptedEnvelope = socketInfo.encryptionCtx
      ? encryptPayload(socketInfo.encryptionCtx, payload)
      : payload;

    // Use Socket.IO's built-in timeout
    // We cast to any because Socket.IO's TypeScript types don't handle
    // dynamic event names well with ack callbacks
    (
      socketInfo.socket.timeout(ACTION_TIMEOUT_MS) as unknown as {
        emit: (
          event: string,
          payload: unknown,
          callback: (err: Error | null, result: ActionResult) => void
        ) => void;
      }
    ).emit(eventName, payloadToSend, (err: Error | null, result: ActionResult) => {
      if (err) {
        logEvent(eventName as EventType, 'system', `${eventName} failed: ${err.message}`);
        if (err.message?.includes('timeout')) {
          reject(new ActionTimeoutError(eventName));
        } else {
          reject(err);
        }
        return;
      }

      logEvent(
        eventName as EventType,
        'in',
        `${eventName} result: ${result.status}`,
        result as Record<string, unknown>
      );
      resolve(result);
    });
  });
}

/**
 * Create a base payload with common fields.
 */
function createBasePayload(): { id: string; initiatedAt: number } {
  return {
    id: randomUUID(),
    initiatedAt: Date.now(),
  };
}

// =============================================================================
// Action Functions
// =============================================================================

/**
 * Open a new session.
 * @param workstationId - The workstation to open the session on
 * @param provider - The AI provider (claude, codex, gemini)
 * @param cwd - Working directory for the session
 * @param name - Optional session name
 */
export function openSession(
  workstationId: string,
  provider: ProviderId,
  cwd: string,
  name?: string
): Promise<ActionResult> {
  const socketInfo = getSocketForAction(workstationId);

  const payload: OpenSessionPayload = {
    ...createBasePayload(),
    provider,
    name,
    cwd,
  };

  return emitWithAck(socketInfo, 'openSession', payload);
}

/**
 * Send a prompt to a session.
 * @param workstationId - The workstation that owns the session
 * @param params - The prompt parameters
 */
export function sendPrompt(
  workstationId: string,
  params: {
    sessionId: string;
    text: string;
    model: ModelId;
    mode: PromptMode;
    lastMessageId?: string;
    lastMessageTs?: number;
  }
): Promise<ActionResult> {
  const socketInfo = getSocketForAction(workstationId);

  const payload: SendPromptPayload = {
    ...createBasePayload(),
    ...params,
  };

  return emitWithAck(socketInfo, 'sendPrompt', payload);
}

/**
 * Stop the agent (interrupt execution).
 * @param workstationId - The workstation that owns the session
 * @param params - The stop parameters
 */
export function stopAgent(
  workstationId: string,
  params: {
    sessionId: string;
    lastMessageId?: string;
    lastMessageTs?: number;
  }
): Promise<ActionResult> {
  const socketInfo = getSocketForAction(workstationId);

  const payload: StopAgentPayload = {
    ...createBasePayload(),
    ...params,
  };

  return emitWithAck(socketInfo, 'stopAgent', payload);
}

/**
 * Unified tool response handler for all tool types.
 * Handles:
 * - Regular tool permission requests (Bash, Edit, Write, etc.)
 * - Plan approvals (ExitPlanMode)
 * - Question answers (AskUserQuestion)
 *
 * @param workstationId - The workstation that owns the session
 * @param params - The tool response parameters
 */
export function approveToolUse(
  workstationId: string,
  params: {
    sessionId: string;
    toolUseId: string;
    toolName: string;
    response: ToolResponse;
    lastMessageId?: string;
    lastMessageTs?: number;
  }
): Promise<ActionResult> {
  const socketInfo = getSocketForAction(workstationId);

  const payload: ApproveToolUsePayload = {
    ...createBasePayload(),
    ...params,
  };

  return emitWithAck(socketInfo, 'approveToolUse', payload);
}
