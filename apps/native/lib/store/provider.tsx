import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Appearance, Platform } from 'react-native';
import type { Indexes, Queries, Relationships, Store } from 'tinybase';
import {
  Provider as TinyBaseProvider,
  useCreateIndexes,
  useCreateQueries,
  useCreateRelationships,
  useCreateStore,
} from 'tinybase/ui-react';

import { CriticalErrorFallback } from '@/components/ErrorFallback';

import { resolveTheme, type ThemePreference } from './core';
import { runMigrations } from './migrations/runner';
import { setDbInstance, setPersisterInstance } from './persister';
import { Persister } from 'tinybase/persisters';

interface StoreContextValue {
  isReady: boolean;
  error: Error | null;
  db: SQLite.SQLiteDatabase | null;
}

const StoreContext = createContext<StoreContextValue>({
  isReady: false,
  error: null,
  db: null,
});

export function useStoreContext() {
  return useContext(StoreContext);
}

interface StoreProviderProps {
  children: ReactNode;
}

/**
 * Store Provider that initializes TinyBase with SQLite persistence.
 * Handles database creation, migrations, and persister setup.
 */
export function StoreProvider({ children }: StoreProviderProps) {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [db, setDb] = useState<SQLite.SQLiteDatabase | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const initIdRef = useRef(0);
  const dbRef = useRef<SQLite.SQLiteDatabase | null>(null);
  const persisterRef = useRef<Persister | null>(null);
  const themeListenerIdRef = useRef<string | null>(null);
  const appearanceSubscriptionRef = useRef<ReturnType<typeof Appearance.addChangeListener> | null>(null);

  // Create TinyBase store with initial values and empty tables
  // Tables must be initialized before autoSave for persister to track them
  const store = useCreateStore(() => {
    const { createStore } = require('tinybase');
    return createStore()
      .setTables({
        sessions: {},
        messages: {},
        projects: {},
        workstations: {},
        artifacts: {},
      })
      .setValues({
        theme: 'system', // Will be updated from persisted value
        device: '', // Will be set after load if empty
        active_session_id: '', // Currently viewed session ID (for real-time artifact updates)
      });
  });

  // Create indexes
  const indexes = useCreateIndexes(store, (store: Store) => {
    const { createIndexes, defaultSorter } = require('tinybase');
    const idx = createIndexes(store);
    idx.setIndexDefinition('sessionsByOpen', 'sessions', 'open');
    // Pre-sorted index by timestamp - avoids O(n log n) sort + n lookups in useMessageIds
    idx.setIndexDefinition(
      'messagesBySession',
      'messages',
      'session_id', // Slice by session_id
      'timestamp', // Sort key (4th param)
      undefined, // No slice sorting (5th param)
      defaultSorter // CRITICAL: Actually applies the sort (6th param)
    );
    idx.setIndexDefinition('sessionsByProject', 'sessions', 'project_id');
    idx.setIndexDefinition('artifactsBySession', 'artifacts', 'session_id');
    return idx;
  });

  // Create relationships
  const relationships = useCreateRelationships(store, (store: Store) => {
    const { createRelationships } = require('tinybase');
    const rels = createRelationships(store);
    rels.setRelationshipDefinition('messageSession', 'messages', 'sessions', 'session_id');
    rels.setRelationshipDefinition('sessionProject', 'sessions', 'projects', 'project_id');
    rels.setRelationshipDefinition(
      'sessionWorkstation',
      'sessions',
      'workstations',
      'workstation_id'
    );
    return rels;
  });

  // Create queries
  const queries = useCreateQueries(store, (store: Store) => {
    const { createQueries } = require('tinybase');
    const q = createQueries(store);
    q.setQueryDefinition('openSessions', 'sessions', ({ select, where }: any) => {
      select('id');
      select('name');
      select('first_message');
      select('provider');
      select('project_id');
      select('workstation_id');
      select('model');
      select('git_branch');
      select('started_at');
      select('ended_at');
      select('message_count');
      select('last_message_at');
      where('open', 1);
    });
    return q;
  });

  const handleRetry = useCallback(() => {
    setError(null);
    setIsReady(false);
    setRetryCount((c) => c + 1);
  }, []);

  useEffect(() => {
    const initId = ++initIdRef.current;
    let cancelled = false;
    const isStale = () => cancelled || initId !== initIdRef.current;
    // Guard async init to prevent stale work after retries or dev reloads.

    const closeDb = async (database: SQLite.SQLiteDatabase | null) => {
      if (!database) return;
      const maybeDb = database as unknown as { closeAsync?: () => Promise<void>; close?: () => Promise<void> };
      try {
        if (typeof maybeDb.closeAsync === 'function') {
          await maybeDb.closeAsync();
        } else if (typeof maybeDb.close === 'function') {
          await maybeDb.close();
        }
      } catch (err) {
        console.warn('[StoreProvider] Failed to close database:', err);
      }
    };

    async function initialize() {
      try {
        // Reset store to clean state before initialization (important for retry).
        // This ensures we don't have corrupted state from a previous failed attempt.
        store.setTables({
          sessions: {},
          messages: {},
          projects: {},
          workstations: {},
          artifacts: {},
        });
        store.setValues({
          theme: 'system',
          device: '',
          active_session_id: '',
        });
        if (isStale()) return;

        // Clear any previous DB handle before re-initializing.
        if (dbRef.current) {
          await closeDb(dbRef.current);
          dbRef.current = null;
          setDbInstance(null);
        }
        setDb(null);

        if (Platform.OS === 'web') {
          // Web: Use OPFS persistence
          const { createOpfsPersister } = await import('tinybase/persisters/persister-browser');
          if (isStale()) return;
          const opfs = await navigator.storage.getDirectory();
          if (isStale()) return;
          const handle = await opfs.getFileHandle('arc0-store.json', { create: true });
          if (isStale()) return;
          const persister = createOpfsPersister(store, handle);
          persisterRef.current = persister;
          await persister.load();
          if (isStale()) return;
          await persister.startAutoSave();
          if (isStale()) return;
          setPersisterInstance(persister);
        } else {
          // Native: Use SQLite with tabular mode
          const database = await SQLite.openDatabaseAsync('arc0.db');
          if (isStale()) {
            await closeDb(database);
            return;
          }
          dbRef.current = database;
          setDb(database);
          setDbInstance(database); // Make available for direct queries

          // Configure SQLite for lower memory usage
          await database.execAsync(`
            PRAGMA cache_size = -20000;
            PRAGMA synchronous = NORMAL;
            PRAGMA temp_store = FILE;
          `);
          if (isStale()) return;

          // Run migrations FIRST (before persister)
          await runMigrations(database);
          if (isStale()) return;

          // Create persister with tabular mode
          const { createExpoSqlitePersister } = await import(
            'tinybase/persisters/persister-expo-sqlite'
          );
          if (isStale()) return;

          const persister = createExpoSqlitePersister(store, database, {
            mode: 'tabular',
            tables: {
              load: {
                // NO 'messages' - loaded on-demand when navigating to a session
                sessions: { tableId: 'sessions', rowIdColumnName: 'id' },
                projects: { tableId: 'projects', rowIdColumnName: 'id' },
                workstations: { tableId: 'workstations', rowIdColumnName: 'id' },
              },
              save: {
                // NO 'messages' - handled manually to avoid data loss
                // NO 'artifacts' - loaded on-demand from SQLite, handled via artifacts-loader.ts
                sessions: { tableName: 'sessions', rowIdColumnName: 'id' },
                projects: { tableName: 'projects', rowIdColumnName: 'id' },
                workstations: { tableName: 'workstations', rowIdColumnName: 'id' },
              },
            },
            values: {
              load: true,
              save: true,
            },
          });
          persisterRef.current = persister;
          if (isStale()) return;

          // Load once at startup
          await persister.load();
          if (isStale()) return;

          // Store persister instance for transaction coordination
          setPersisterInstance(persister);

          // AutoSave only (NO autoLoad - it uses setContent() which replaces entire store)
          await persister.startAutoSave();
          if (isStale()) return;
          console.log('[StoreProvider] Persister initialized, autoSave started');
        }

        // Generate device ID if not already set
        const deviceId = store.getValue('device');
        if (!deviceId) {
          const newDeviceId = Crypto.randomUUID();
          store.setValue('device', newDeviceId);
        }

        // Note: Default ~ project is created per-workstation when workstation is added
        // (in SocketProvider.addWorkstation - projects table includes workstation_id)

        // Sync theme to Uniwind (resolves 'system' to actual theme)
        const { Uniwind } = await import('uniwind');
        if (isStale()) return;
        const syncTheme = () => {
          const preference = store.getValue('theme') as ThemePreference | undefined;
          if (preference) {
            Uniwind.setTheme(resolveTheme(preference));
          }
        };
        syncTheme();
        themeListenerIdRef.current = store.addValueListener('theme', syncTheme);

        // Listen for system appearance changes when preference is 'system'
        appearanceSubscriptionRef.current = Appearance.addChangeListener(({ colorScheme }) => {
          const preference = store.getValue('theme') as ThemePreference | undefined;
          if (preference === 'system') {
            const resolved = colorScheme === 'dark' ? 'dark' : 'light';
            Uniwind.setTheme(resolved);
          }
        });

        // Wait for next tick to ensure TinyBase hooks see the loaded data
        // Without this, useTable() may return stale empty data on first render after isReady
        await new Promise((resolve) => setTimeout(resolve, 0));
        if (isStale()) return;

        setIsReady(true);
      } catch (err) {
        console.error('[StoreProvider] Initialization failed:', err);
        if (isStale()) return;
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    initialize();

    return () => {
      cancelled = true;
      // Cleanup listeners and persister on unmount / retry.
      if (themeListenerIdRef.current) {
        store.delListener(themeListenerIdRef.current);
        themeListenerIdRef.current = null;
      }
      if (appearanceSubscriptionRef.current) {
        appearanceSubscriptionRef.current.remove();
        appearanceSubscriptionRef.current = null;
      }
      if (persisterRef.current) {
        persisterRef.current.stopAutoSave?.();
        persisterRef.current.stopAutoLoad?.();
        persisterRef.current.destroy?.();
        persisterRef.current = null;
        setPersisterInstance(null);
      }
      if (dbRef.current) {
        void closeDb(dbRef.current);
        dbRef.current = null;
        setDbInstance(null);
      }
    };
  }, [store, retryCount]);

  // Show error UI if initialization failed
  if (error) {
    console.error('[StoreProvider] Initialization error:', error);
    return <CriticalErrorFallback error={error} onRetry={handleRetry} />;
  }

  return (
    <StoreContext.Provider value={{ isReady, error, db }}>
      <TinyBaseProvider
        store={store}
        indexes={indexes as Indexes}
        relationships={relationships as Relationships}
        queries={queries as Queries}
      >
        {children}
      </TinyBaseProvider>
    </StoreContext.Provider>
  );
}
