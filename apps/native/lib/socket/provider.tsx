/**
 * Socket.IO Provider for React Native with multi-workstation support.
 * Manages multiple socket connections via SocketManager.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useStore, useTable, useValue } from 'tinybase/ui-react';
import { generateProjectId, handleMessagesBatch, handleSessionsSync } from '../store/handlers';
import { useStoreContext } from '../store/provider';
import {
  getWorkstationAuthToken,
  setWorkstationAuthToken,
  deleteWorkstationAuthToken,
  setWorkstationEncryptionKey,
  deleteWorkstationEncryptionKey,
  getWorkstationEncryptionKey,
} from '../settings/workstations';
import { getSocketManager } from './manager';
import type {
  ConnectionState,
  TimelineBatchPayload,
  SessionCursor,
  SessionsSyncPayload,
} from './types';

// =============================================================================
// Types
// =============================================================================

interface WorkstationRow {
  name?: string;
  url?: string;
  enabled?: number;
  active?: number;
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// Context
// =============================================================================

interface SocketContextValue {
  /** Connection state for the active workstation */
  connectionState: ConnectionState;
  /** All connection states by workstation ID */
  allConnectionStates: Map<string, ConnectionState>;
  /** Connect to all enabled workstations */
  connectAll: () => Promise<void>;
  /** Disconnect from all workstations */
  disconnectAll: () => void;
  /** Reconnect to all enabled workstations */
  reconnectAll: () => Promise<void>;
  /** Add a new workstation (workstationId comes from Base via pairing) */
  addWorkstation: (
    workstationId: string,
    name: string,
    url: string,
    authToken: string,
    encryptionKey?: string
  ) => Promise<void>;
  /** Update a workstation */
  updateWorkstation: (
    id: string,
    updates: { name?: string; url?: string; enabled?: boolean }
  ) => Promise<void>;
  /** Remove a workstation */
  removeWorkstation: (id: string) => Promise<void>;
  /** Set the active workstation */
  setActiveWorkstation: (id: string) => void;
  /** Get the active workstation ID */
  activeWorkstationId: string | null;
  /** Get count of background connected workstations (excluding active) */
  backgroundConnectedCount: number;
  /** Whether the initial connection attempt has been made (useful for UI to distinguish "initializing" from "daemon not running") */
  hasAttemptedInitialConnect: boolean;
}

const SocketContext = createContext<SocketContextValue | null>(null);

// =============================================================================
// Provider
// =============================================================================

interface SocketProviderProps {
  children: ReactNode;
  /** Auto-connect when store is ready (default: true) */
  autoConnect?: boolean;
}

export function SocketProvider({ children, autoConnect = true }: SocketProviderProps) {
  const { isReady: storeReady, db } = useStoreContext();
  const store = useStore();

  // Keep store in ref for callbacks that need latest value without re-registration
  const storeRef = useRef(store);
  useEffect(() => {
    storeRef.current = store;
  }, [store]);

  // Get device ID from TinyBase store
  const deviceId = useValue('device') as string | undefined;
  const deviceIdRef = useRef(deviceId ?? '');

  useEffect(() => {
    deviceIdRef.current = deviceId ?? '';
  }, [deviceId]);

  // Get workstations from TinyBase store
  const workstationsTable = useTable('workstations') as Record<string, WorkstationRow>;

  // Keep workstationsTable in ref for effects that need latest value without re-triggering
  const workstationsTableRef = useRef(workstationsTable);
  useEffect(() => {
    workstationsTableRef.current = workstationsTable;
  }, [workstationsTable]);

  // Track if initial connection attempt has been made
  // State is used so UI can react to it and show "Connecting" during initialization
  // Ref is used to prevent cleanup function from disconnecting on state change re-render
  const [hasAttemptedInitialConnect, setHasAttemptedInitialConnect] = useState(false);
  const hasAttemptedRef = useRef(false);

  // Get SocketManager instance
  const manager = useMemo(() => getSocketManager(), []);
  const isActiveRef = useRef(true);

  // Expose SocketManager globally for testing and debugging
  useEffect(() => {
    if (__DEV__) {
      (window as any).__ARC0_SOCKET_MANAGER__ = manager;
      console.log('[SocketProvider] SocketManager exposed as window.__ARC0_SOCKET_MANAGER__');
    }
  }, [manager]);

  // Ensure sockets are closed on unmount / dev reload to avoid duplicate connections.
  useEffect(() => {
    // Reset activity flag on each mount/effect run so dev reloads can reconnect.
    isActiveRef.current = true;
    return () => {
      isActiveRef.current = false;
      manager.disconnectAll();
    };
  }, [manager]);

  // Subscribe to connection states via useSyncExternalStore
  const allConnectionStates = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot
  );

  // Find active workstation
  const activeWorkstationId = useMemo(() => {
    for (const [id, row] of Object.entries(workstationsTable)) {
      if (row.active === 1) {
        return id;
      }
    }
    return null;
  }, [workstationsTable]);

  // Get connection state for active workstation
  const connectionState: ConnectionState = useMemo(() => {
    if (!activeWorkstationId) {
      return storeReady ? { status: 'disconnected' } : { status: 'connecting' };
    }

    const existingState = allConnectionStates.get(activeWorkstationId);
    if (existingState) {
      return existingState;
    }

    const activeRow = workstationsTable[activeWorkstationId];
    const canConnect = activeRow?.enabled === 1 && Boolean(activeRow.url);

    // Avoid brief "disconnected" flashes before the first connect() is initiated.
    if (autoConnect && canConnect) {
      return { status: 'connecting' };
    }

    return { status: 'disconnected' };
  }, [activeWorkstationId, allConnectionStates, autoConnect, storeReady, workstationsTable]);

  // Count background connected workstations (excluding active)
  const backgroundConnectedCount = useMemo(() => {
    let count = 0;
    for (const [id, state] of allConnectionStates) {
      if (id !== activeWorkstationId && state.status === 'connected') {
        count++;
      }
    }
    return count;
  }, [activeWorkstationId, allConnectionStates]);

  // ==========================================================================
  // Event Handlers
  // ==========================================================================

  const onSessionsSync = useCallback(
    async (payload: SessionsSyncPayload): Promise<void> => {
      if (!store) {
        console.warn('[SocketProvider] Store not ready, ignoring sessions');
        return;
      }

      try {
        await handleSessionsSync(store, payload);
      } catch (error) {
        console.error('[SocketProvider] Error handling sessions:', error);
      }
    },
    [store]
  );

  const onMessagesBatch = useCallback(
    async (payload: TimelineBatchPayload): Promise<void> => {
      if (!store) {
        console.warn('[SocketProvider] Store not ready, ignoring messages');
        return;
      }

      try {
        await handleMessagesBatch(store, payload);
      } catch (error) {
        console.error('[SocketProvider] Error handling messages:', error);
      }
    },
    [store]
  );

  // Get session cursors for a specific workstation
  // Uses storeRef to always get latest store on reconnection without re-registering handler
  const getSessionCursors = useCallback((workstationId: string): SessionCursor[] => {
    if (!storeRef.current) return [];

    const cursors: SessionCursor[] = [];
    const sessions = storeRef.current.getTable('sessions');

    for (const [sessionId, session] of Object.entries(sessions)) {
      // Only include sessions from this workstation that have messages
      if (session.workstation_id === workstationId) {
        const lastMessageAt = session.last_message_at as string | undefined;
        if (lastMessageAt) {
          cursors.push({
            sessionId,
            lastMessageTs: lastMessageAt,
          });
        }
      }
    }

    return cursors;
  }, []);

  // Register handlers with manager
  useEffect(() => {
    manager.registerHandlers({
      onSessionsSync,
      onMessagesBatch,
      getDeviceId: () => deviceIdRef.current,
      getSessionCursors,
    });
  }, [manager, onSessionsSync, onMessagesBatch, getSessionCursors]);

  // ==========================================================================
  // Connection Management
  // ==========================================================================

  const connectAll = useCallback(async () => {
    if (!store) return;

    console.log('[SocketProvider] Connecting to all enabled workstations...');

    for (const [id, row] of Object.entries(workstationsTable)) {
      if (row.enabled === 1 && row.url) {
        const authToken = await getWorkstationAuthToken(id);
        const encryptionKey = await getWorkstationEncryptionKey(id);
        if (!authToken) continue;
        if (!isActiveRef.current) return;
        manager.connect(id, row.url, {
          authToken,
          encryptionKey: encryptionKey ?? undefined,
        });
      }
    }
  }, [store, workstationsTable, manager]);

  const disconnectAll = useCallback(() => {
    console.log('[SocketProvider] Disconnecting all workstations...');
    manager.disconnectAll();
  }, [manager]);

  const reconnectAll = useCallback(async () => {
    console.log('[SocketProvider] Reconnecting all workstations...');
    disconnectAll();
    await new Promise((resolve) => setTimeout(resolve, 100));
    await connectAll();
  }, [connectAll, disconnectAll]);

  // ==========================================================================
  // Workstation Management
  // ==========================================================================

  const addWorkstation = useCallback(
    async (
      workstationId: string,
      name: string,
      url: string,
      authToken: string,
      encryptionKey?: string
    ): Promise<void> => {
      if (!store) throw new Error('Store not ready');

      const now = new Date().toISOString();

      // Check if this is the first workstation (should be active)
      const existingWorkstations = Object.keys(workstationsTable);
      const isFirst = existingWorkstations.length === 0;

      // Save to TinyBase
      store.setRow('workstations', workstationId, {
        name,
        url,
        enabled: 1,
        active: isFirst ? 1 : 0,
        created_at: now,
        updated_at: now,
      });

      // Create default ~ project for this workstation
      const defaultProjectId = await generateProjectId(workstationId, '~');
      store.setRow('projects', defaultProjectId, {
        workstation_id: workstationId,
        path: '~',
        name: 'Home',
        starred: 0,
        created_at: now,
        updated_at: now,
      });

      // Save auth token to secure storage
      await setWorkstationAuthToken(workstationId, authToken);

      // Save encryption key if provided
      if (encryptionKey) {
        await setWorkstationEncryptionKey(workstationId, encryptionKey);
      }

      // Connect to the new workstation
      if (!isActiveRef.current) return;
      manager.connect(workstationId, url, { authToken, encryptionKey });

      console.log(`[SocketProvider] Added workstation ${workstationId}: ${name} at ${url}`);
    },
    [store, workstationsTable, manager]
  );

  const updateWorkstation = useCallback(
    async (
      id: string,
      updates: { name?: string; url?: string; enabled?: boolean }
    ): Promise<void> => {
      if (!store) throw new Error('Store not ready');

      const existing = workstationsTable[id];
      if (!existing) throw new Error(`Workstation ${id} not found`);

      // Prevent disabling if this is the only enabled workstation
      if (updates.enabled === false && existing.enabled === 1) {
        const otherEnabledCount = Object.entries(workstationsTable).filter(
          ([wsId, row]) => wsId !== id && row.enabled === 1
        ).length;

        if (otherEnabledCount === 0) {
          throw new Error('Cannot disable the only enabled workstation');
        }
      }

      const now = new Date().toISOString();
      const storeUpdates: Partial<WorkstationRow> = { updated_at: now };

      if (updates.name !== undefined) storeUpdates.name = updates.name;
      if (updates.url !== undefined) storeUpdates.url = updates.url;
      if (updates.enabled !== undefined) storeUpdates.enabled = updates.enabled ? 1 : 0;

      // Update TinyBase
      store.setPartialRow('workstations', id, storeUpdates);

      // Handle connection changes
      const wasEnabled = existing.enabled === 1;
      const newEnabled = updates.enabled ?? wasEnabled;
      const newUrl = updates.url ?? existing.url ?? '';

      if (!newEnabled) {
        // Disconnect if disabled
        manager.disconnect(id);

        // If this was the active workstation, transfer active to another enabled one
        if (existing.active === 1) {
          const enabledWorkstationId = Object.entries(workstationsTable).find(
            ([wsId, row]) => wsId !== id && row.enabled === 1
          )?.[0];

          if (enabledWorkstationId) {
            store.setPartialRow('workstations', id, { active: 0 });
            store.setPartialRow('workstations', enabledWorkstationId, {
              active: 1,
              updated_at: now,
            });
            console.log(
              `[SocketProvider] Transferred active from disabled ${id} to ${enabledWorkstationId}`
            );
          }
        }
      } else if (updates.url !== undefined) {
        // Reconnect if URL changed
        const authToken = await getWorkstationAuthToken(id);
        const encryptionKey = await getWorkstationEncryptionKey(id);
        if (!authToken) {
          manager.disconnect(id);
          return;
        }
        await manager.reconnect(id, newUrl, {
          authToken,
          encryptionKey: encryptionKey ?? undefined,
        });
      } else if (!wasEnabled && newEnabled && newUrl) {
        // Re-enabled: connect with stored credentials
        const authToken = await getWorkstationAuthToken(id);
        const encryptionKey = await getWorkstationEncryptionKey(id);
        if (!authToken) return;
        if (!isActiveRef.current) return;
        manager.connect(id, newUrl, {
          authToken,
          encryptionKey: encryptionKey ?? undefined,
        });
      }

      console.log(`[SocketProvider] Updated workstation ${id}`);
    },
    [store, workstationsTable, manager]
  );

  const removeWorkstation = useCallback(
    async (id: string): Promise<void> => {
      if (!store) throw new Error('Store not ready');

      const existing = workstationsTable[id];
      if (!existing) throw new Error(`Workstation ${id} not found`);

      // Disconnect
      manager.disconnect(id);

      // Delete auth token and encryption key
      await deleteWorkstationAuthToken(id);
      await deleteWorkstationEncryptionKey(id);

      // Delete all data for this workstation (messages, sessions, projects)
      const sessionsTable = store.getTable('sessions') as Record<
        string,
        { workstation_id?: string }
      >;
      const messagesTable = store.getTable('messages') as Record<string, { session_id?: string }>;
      const projectsTable = store.getTable('projects') as Record<
        string,
        { workstation_id?: string }
      >;

      // Find all sessions for this workstation
      const sessionIds = Object.entries(sessionsTable)
        .filter(([, row]) => row.workstation_id === id)
        .map(([sessionId]) => sessionId);

      // Delete messages for those sessions
      for (const [messageId, row] of Object.entries(messagesTable)) {
        if (row.session_id && sessionIds.includes(row.session_id)) {
          store.delRow('messages', messageId);
        }
      }

      // Delete artifacts for those sessions
      const artifactsTable = store.getTable('artifacts') as Record<string, { session_id?: string }>;
      for (const [artifactId, row] of Object.entries(artifactsTable)) {
        if (row.session_id && sessionIds.includes(row.session_id)) {
          store.delRow('artifacts', artifactId);
        }
      }

      // Delete sessions
      for (const sessionId of sessionIds) {
        store.delRow('sessions', sessionId);
      }

      // Delete projects for this workstation
      for (const [projectId, row] of Object.entries(projectsTable)) {
        if (row.workstation_id === id) {
          store.delRow('projects', projectId);
        }
      }

      // Delete the workstation itself
      store.delRow('workstations', id);

      // Delete from SQLite (native only) - messages/artifacts don't have AutoSave
      if (db && sessionIds.length > 0) {
        const placeholders = sessionIds.map(() => '?').join(',');
        await db.runAsync(`DELETE FROM messages WHERE session_id IN (${placeholders})`, sessionIds);
        await db.runAsync(
          `DELETE FROM artifacts WHERE session_id IN (${placeholders})`,
          sessionIds
        );
        await db.runAsync(`DELETE FROM sessions WHERE id IN (${placeholders})`, sessionIds);
      }
      if (db) {
        await db.runAsync('DELETE FROM projects WHERE workstation_id = ?', [id]);
        await db.runAsync('DELETE FROM workstations WHERE id = ?', [id]);
      }

      // If this was the active workstation, set another one as active
      if (existing.active === 1) {
        const remainingIds = Object.keys(workstationsTable).filter((wsId) => wsId !== id);
        if (remainingIds.length > 0) {
          store.setPartialRow('workstations', remainingIds[0], {
            active: 1,
            updated_at: new Date().toISOString(),
          });
        }
      }

      console.log(`[SocketProvider] Removed workstation ${id} and all related data`);
    },
    [store, workstationsTable, manager, db]
  );

  const setActiveWorkstation = useCallback(
    (id: string): void => {
      if (!store) return;

      const existing = workstationsTable[id];
      if (!existing) {
        console.warn(`[SocketProvider] Workstation ${id} not found`);
        return;
      }

      const now = new Date().toISOString();

      // Set all workstations to inactive
      for (const wsId of Object.keys(workstationsTable)) {
        if (wsId !== id) {
          store.setPartialRow('workstations', wsId, {
            active: 0,
            updated_at: now,
          });
        }
      }

      // Set the target workstation to active
      store.setPartialRow('workstations', id, {
        active: 1,
        updated_at: now,
      });

      console.log(`[SocketProvider] Set active workstation to ${id}`);
    },
    [store, workstationsTable]
  );

  // ==========================================================================
  // Auto-connect on startup
  // ==========================================================================

  // Initial connect when store becomes ready - runs once
  // Uses ref to track attempt to avoid cleanup running on state change re-render
  useEffect(() => {
    if (!autoConnect || !storeReady || hasAttemptedRef.current) return;

    // Mark as attempted BEFORE any async work - this lets UI show "Connecting" immediately
    hasAttemptedRef.current = true;
    setHasAttemptedInitialConnect(true);

    const table = workstationsTableRef.current;
    const workstationIds = Object.keys(table);
    if (workstationIds.length === 0) {
      console.log('[SocketProvider] No workstations configured');
      return;
    }

    console.log('[SocketProvider] Store ready, connecting to workstations...');

    // Connect to all enabled workstations
    for (const [id, row] of Object.entries(table)) {
      if (row.enabled === 1 && row.url) {
        Promise.all([getWorkstationAuthToken(id), getWorkstationEncryptionKey(id)]).then(
          ([authToken, encryptionKey]) => {
            if (!authToken) return;
            if (!isActiveRef.current) return;
            manager.connect(id, row.url!, {
              authToken,
              encryptionKey: encryptionKey ?? undefined,
            });
          }
        );
      }
    }

    return () => {
      manager.disconnectAll();
    };
  }, [autoConnect, storeReady, manager]);

  // Handle workstation changes after initial connect (new workstation added, enabled/disabled, removed)
  const workstationIdsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!storeReady || !autoConnect) return;

    const currentIds = Object.keys(workstationsTable);
    const previousIds = workstationIdsRef.current;

    // Skip initial render (handled by the initial connect effect above)
    if (previousIds.length === 0 && !hasAttemptedRef.current) {
      workstationIdsRef.current = currentIds;
      return;
    }

    // Check for removed workstations
    for (const id of previousIds) {
      if (!currentIds.includes(id)) {
        manager.disconnect(id);
      }
    }

    workstationIdsRef.current = currentIds;
  }, [storeReady, autoConnect, workstationsTable, manager]);

  // ==========================================================================
  // App state handling (foreground/background)
  // ==========================================================================

  useEffect(() => {
    if (!autoConnect || !storeReady) return;

    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        // App came to foreground - reconnect disconnected workstations
        const workstationIds = Object.keys(workstationsTable);
        for (const id of workstationIds) {
          const row = workstationsTable[id];
          const state = manager.getConnectionState(id);
          if (row.enabled === 1 && row.url && state.status === 'disconnected') {
            console.log(`[SocketProvider] App active, reconnecting ${id}...`);
            Promise.all([getWorkstationAuthToken(id), getWorkstationEncryptionKey(id)]).then(
              ([authToken, encryptionKey]) => {
                if (!authToken) return;
                if (!isActiveRef.current) return;
                manager.connect(id, row.url!, {
                  authToken,
                  encryptionKey: encryptionKey ?? undefined,
                });
              }
            );
          }
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [autoConnect, storeReady, workstationsTable, manager]);

  // ==========================================================================
  // Render
  // ==========================================================================

  const value: SocketContextValue = {
    connectionState,
    allConnectionStates,
    connectAll,
    disconnectAll,
    reconnectAll,
    addWorkstation,
    updateWorkstation,
    removeWorkstation,
    setActiveWorkstation,
    activeWorkstationId,
    backgroundConnectedCount,
    hasAttemptedInitialConnect,
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

// =============================================================================
// Hooks
// =============================================================================

/**
 * Access the socket context.
 * Must be used within a SocketProvider.
 */
export function useSocketContext(): SocketContextValue {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocketContext must be used within a SocketProvider');
  }
  return context;
}

/**
 * Get the current connection status (for active workstation).
 * Convenience hook that extracts just the status from connection state.
 */
export function useConnectionStatus(): ConnectionState['status'] {
  const { connectionState } = useSocketContext();
  return connectionState.status;
}

/**
 * Get the full connection state (for active workstation).
 */
export function useConnectionState(): ConnectionState {
  const { connectionState } = useSocketContext();
  return connectionState;
}

/**
 * Get the active workstation ID.
 */
export function useActiveWorkstationId(): string | null {
  const { activeWorkstationId } = useSocketContext();
  return activeWorkstationId;
}

/**
 * Get the count of background connected workstations.
 */
export function useBackgroundConnectedCount(): number {
  const { backgroundConnectedCount } = useSocketContext();
  return backgroundConnectedCount;
}

/**
 * Check if the initial connection attempt has been made.
 * Useful for distinguishing "initializing" from "daemon not running".
 */
export function useHasAttemptedInitialConnect(): boolean {
  const { hasAttemptedInitialConnect } = useSocketContext();
  return hasAttemptedInitialConnect;
}
