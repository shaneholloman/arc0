/**
 * SocketManager: Central coordinator for multiple workstation connections.
 * Manages a Map of workstation ID -> Socket connection.
 *
 * Supports both legacy (shared secret) and E2E encrypted modes.
 *
 * Uses useSyncExternalStore pattern for React integration.
 */

import { io, Socket } from 'socket.io-client';
import { logEvent } from './eventLogger';
import {
  encryptPayload,
  decryptPayload,
  isEncryptedEnvelope,
  clearKeyCache,
  type EncryptionContext,
} from './encryption';
import type {
  ClientToServerEvents,
  ConnectionState,
  EncryptedEnvelope,
  InitPayload,
  RawMessagesBatchPayload,
  ServerToClientEvents,
  SessionCursor,
  SessionsSyncPayload,
} from './types';

// Type-safe socket instance
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

// =============================================================================
// Types
// =============================================================================

export interface WorkstationCredentials {
  /** Auth token for socket authentication (base64) */
  authToken?: string;
  /** Encryption key for E2E encryption (base64) */
  encryptionKey?: string;
  /** Legacy: shared secret */
  secret?: string;
}

export interface WorkstationConnection {
  socket: AppSocket;
  state: ConnectionState;
  url: string;
  /** Encryption context if using E2E encryption */
  encryptionCtx?: EncryptionContext;
}

export interface SocketManagerHandlers {
  onSessionsSync: (payload: SessionsSyncPayload) => Promise<void>;
  onMessagesBatch: (payload: RawMessagesBatchPayload) => Promise<void>;
  getDeviceId: () => string;
  getSessionCursors: (workstationId: string) => SessionCursor[];
}

// =============================================================================
// SocketManager Class
// =============================================================================

export class SocketManager {
  private connections: Map<string, WorkstationConnection> = new Map();
  private listeners: Set<() => void> = new Set();
  private handlers: SocketManagerHandlers | null = null;
  // Cached snapshot for useSyncExternalStore - must be stable reference
  private cachedSnapshot: Map<string, ConnectionState> = new Map();

  // ==========================================================================
  // Handler Registration
  // ==========================================================================

  /**
   * Register handlers for socket events.
   * Must be called before connecting to any workstation.
   */
  registerHandlers(handlers: SocketManagerHandlers): void {
    this.handlers = handlers;
  }

  // ==========================================================================
  // Connection Lifecycle
  // ==========================================================================

  /**
   * Connect to a workstation with credentials.
   * Supports both legacy (shared secret) and new E2E encrypted modes.
   *
   * @param workstationId - Unique identifier for the workstation
   * @param url - Socket.IO server URL
   * @param credentials - Auth credentials (secret, authToken, or encryptionKey)
   */
  connect(workstationId: string, url: string, credentials?: WorkstationCredentials): void {
    // Check if already connected
    const existing = this.connections.get(workstationId);
    if (existing?.socket?.connected) {
      console.log(`[SocketManager] Workstation ${workstationId} already connected`);
      return;
    }

    // Clean up existing socket if any
    if (existing?.socket) {
      existing.socket.removeAllListeners();
      existing.socket.close();
      // Clear encryption key cache
      if (existing.encryptionCtx) {
        clearKeyCache(existing.encryptionCtx.encryptionKey);
      }
    }

    console.log(`[SocketManager] Connecting to ${workstationId} at ${url}...`);

    // Create encryption context if using E2E encryption
    let encryptionCtx: EncryptionContext | undefined;
    if (credentials?.encryptionKey) {
      encryptionCtx = { encryptionKey: credentials.encryptionKey };
    }

    // Create initial state
    const state: ConnectionState = { status: 'connecting' };
    const socket = this.createSocket(workstationId, url, credentials, encryptionCtx);

    this.connections.set(workstationId, { socket, state, url, encryptionCtx });
    this.notifyListeners();
  }

  /**
   * Legacy connect method for backward compatibility.
   * @deprecated Use connect(workstationId, url, { secret }) instead
   */
  connectLegacy(workstationId: string, url: string, secret?: string): void {
    this.connect(workstationId, url, secret ? { secret } : undefined);
  }

  /**
   * Disconnect from a specific workstation.
   */
  disconnect(workstationId: string): void {
    const connection = this.connections.get(workstationId);
    if (connection) {
      console.log(`[SocketManager] Disconnecting from ${workstationId}...`);
      connection.socket.removeAllListeners();
      connection.socket.close();
      this.connections.delete(workstationId);
      this.notifyListeners();
    }
  }

  /**
   * Disconnect from all workstations.
   */
  disconnectAll(): void {
    console.log('[SocketManager] Disconnecting all workstations...');
    for (const [id, connection] of this.connections) {
      console.log(`[SocketManager] Closing connection to ${id}`);
      connection.socket.removeAllListeners();
      connection.socket.close();
    }
    this.connections.clear();
    this.notifyListeners();
  }

  /**
   * Reconnect to a workstation (disconnect then connect).
   */
  async reconnect(
    workstationId: string,
    url: string,
    credentials?: WorkstationCredentials
  ): Promise<void> {
    this.disconnect(workstationId);
    // Small delay to ensure clean disconnect
    await new Promise((resolve) => setTimeout(resolve, 100));
    this.connect(workstationId, url, credentials);
  }

  // ==========================================================================
  // State Access (useSyncExternalStore compatible)
  // ==========================================================================

  /**
   * Get connection state for a specific workstation.
   */
  getConnectionState(workstationId: string): ConnectionState {
    const connection = this.connections.get(workstationId);
    return connection?.state ?? { status: 'disconnected' };
  }

  /**
   * Get all connection states as a Map.
   * Returns a new Map on each call to ensure React detects changes.
   */
  getAllConnectionStates(): Map<string, ConnectionState> {
    const states = new Map<string, ConnectionState>();
    for (const [id, connection] of this.connections) {
      states.set(id, connection.state);
    }
    return states;
  }

  /**
   * Get count of connected workstations (excluding a specific one).
   */
  getConnectedCount(excludeId?: string): number {
    let count = 0;
    for (const [id, connection] of this.connections) {
      if (id !== excludeId && connection.state.status === 'connected') {
        count++;
      }
    }
    return count;
  }

  /**
   * Check if a workstation is connected.
   */
  isConnected(workstationId: string): boolean {
    const connection = this.connections.get(workstationId);
    return connection?.socket?.connected ?? false;
  }

  /**
   * Get the socket for a specific workstation.
   * Returns null if not connected.
   */
  getSocket(workstationId: string): AppSocket | null {
    const connection = this.connections.get(workstationId);
    return connection?.socket ?? null;
  }

  /**
   * Get encryption context for a specific workstation.
   * Returns undefined if not using encryption.
   */
  getEncryptionContext(workstationId: string): EncryptionContext | undefined {
    const connection = this.connections.get(workstationId);
    return connection?.encryptionCtx;
  }

  /**
   * Subscribe to state changes.
   * Compatible with useSyncExternalStore.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Get snapshot for useSyncExternalStore.
   * Returns a cached reference that only changes when notifyListeners is called.
   */
  getSnapshot = (): Map<string, ConnectionState> => {
    return this.cachedSnapshot;
  };

  // ==========================================================================
  // Private Methods
  // ==========================================================================

  private notifyListeners(): void {
    // Rebuild cached snapshot before notifying (required for useSyncExternalStore)
    this.cachedSnapshot = this.getAllConnectionStates();
    this.listeners.forEach((listener) => listener());
  }

  private updateConnectionState(workstationId: string, updates: Partial<ConnectionState>): void {
    const connection = this.connections.get(workstationId);
    if (connection) {
      connection.state = { ...connection.state, ...updates };
      this.notifyListeners();
    }
  }

  private createSocket(
    workstationId: string,
    url: string,
    credentials?: WorkstationCredentials,
    encryptionCtx?: EncryptionContext
  ): AppSocket {
    // Build auth object based on credentials
    let auth: Record<string, string> | undefined;
    if (credentials?.authToken && this.handlers) {
      // New E2E encrypted mode with per-client token
      auth = {
        deviceId: this.handlers.getDeviceId(),
        authToken: credentials.authToken,
      };
    } else if (credentials?.secret) {
      // Legacy shared secret mode
      auth = { secret: credentials.secret };
    }

    const socket = io(url, {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 4000,
      path: '/socket.io',
      ...(auth && { auth }),
    }) as AppSocket;

    // Connection events
    socket.on('connect', () => {
      console.log(`[SocketManager] ${workstationId} connected`);
      logEvent('connect', 'system', `Connected to ${workstationId}`);
      this.updateConnectionState(workstationId, {
        status: 'connected',
        lastConnected: new Date(),
        reconnectAttempts: 0,
        error: undefined,
      });

      // Send init with device ID and session cursors
      if (this.handlers) {
        const deviceId = this.handlers.getDeviceId();
        const cursor = this.handlers.getSessionCursors(workstationId);
        const initPayload: InitPayload = { deviceId, cursor };
        socket.emit('init', initPayload);
        console.log(
          `[SocketManager] ${workstationId} sent init: device=${deviceId} cursors=${cursor.length}`
        );
        logEvent('init', 'out', `Sent init to ${workstationId}`, {
          deviceId,
          cursorCount: cursor.length,
        });
      }
    });

    socket.on('disconnect', (reason) => {
      console.log(`[SocketManager] ${workstationId} disconnected: ${reason}`);
      logEvent('disconnect', 'system', `${workstationId} disconnected: ${reason}`);
      this.updateConnectionState(workstationId, { status: 'disconnected' });
    });

    socket.on('connect_error', (error) => {
      console.info(`[SocketManager] ${workstationId} connection error:`, error.message);
      logEvent('error', 'system', `${workstationId} connection error: ${error.message}`);
      this.updateConnectionState(workstationId, {
        status: 'error',
        error: error.message,
      });
    });

    // Reconnection events
    socket.io.on('reconnect_attempt', (attempt) => {
      console.log(`[SocketManager] ${workstationId} reconnection attempt ${attempt}`);
      logEvent('reconnect', 'system', `${workstationId} reconnection attempt ${attempt}`);
      this.updateConnectionState(workstationId, {
        status: 'connecting',
        reconnectAttempts: attempt,
      });
    });

    socket.io.on('reconnect', (attempt) => {
      console.log(`[SocketManager] ${workstationId} reconnected after ${attempt} attempts`);
      logEvent('reconnect', 'system', `${workstationId} reconnected after ${attempt} attempts`);
      this.updateConnectionState(workstationId, {
        status: 'connected',
        lastConnected: new Date(),
        reconnectAttempts: 0,
      });
    });

    socket.io.on('reconnect_failed', () => {
      console.info(`[SocketManager] ${workstationId} reconnection failed`);
      logEvent('error', 'system', `${workstationId} reconnection failed`);
      this.updateConnectionState(workstationId, {
        status: 'error',
        error: 'Failed to reconnect after multiple attempts',
      });
    });

    // Business events - decrypt if encrypted
    socket.on('sessions', async (payloadOrEnvelope) => {
      try {
        // Decrypt if encrypted
        let payload: SessionsSyncPayload;
        if (encryptionCtx && isEncryptedEnvelope(payloadOrEnvelope)) {
          payload = decryptPayload<SessionsSyncPayload>(encryptionCtx, payloadOrEnvelope);
        } else {
          payload = payloadOrEnvelope as unknown as SessionsSyncPayload;
        }

        console.log(
          `[SocketManager] ${workstationId} received ${payload.sessions.length} sessions`
        );
        logEvent('sessions', 'in', `${workstationId}: ${payload.sessions.length} sessions`, {
          workstationId: payload.workstationId,
          sessionCount: payload.sessions.length,
        });
        if (this.handlers) {
          await this.handlers.onSessionsSync(payload);
        }
      } catch (error) {
        console.error(`[SocketManager] ${workstationId} error handling sessions:`, error);
        logEvent('error', 'system', `${workstationId} error processing sessions`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    socket.on('messages', async (payloadOrEnvelope, callback) => {
      try {
        // Decrypt if encrypted
        let payload: RawMessagesBatchPayload;
        if (encryptionCtx && isEncryptedEnvelope(payloadOrEnvelope)) {
          payload = decryptPayload<RawMessagesBatchPayload>(encryptionCtx, payloadOrEnvelope);
        } else {
          payload = payloadOrEnvelope as unknown as RawMessagesBatchPayload;
        }

        console.log(
          `[SocketManager] ${workstationId} received ${payload.messages.length} messages`
        );
        logEvent('messages', 'in', `${workstationId}: ${payload.messages.length} messages`, {
          batchId: payload.batchId,
          workstationId: payload.workstationId,
          messageCount: payload.messages.length,
        });
        if (this.handlers) {
          await this.handlers.onMessagesBatch(payload);
          callback();
        } else {
          callback();
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[SocketManager] ${workstationId} error handling messages:`, errorMessage);
        logEvent('error', 'system', `${workstationId} error processing messages`, {
          error: errorMessage,
        });
        callback();
      }
    });

    return socket;
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let managerInstance: SocketManager | null = null;

/**
 * Get the singleton SocketManager instance.
 */
export function getSocketManager(): SocketManager {
  if (!managerInstance) {
    managerInstance = new SocketManager();
  }
  return managerInstance;
}

/**
 * Reset the singleton (for testing purposes).
 */
export function resetSocketManager(): void {
  if (managerInstance) {
    managerInstance.disconnectAll();
    managerInstance = null;
  }
}
