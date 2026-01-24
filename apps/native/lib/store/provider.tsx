import * as Crypto from 'expo-crypto';
import * as SQLite from 'expo-sqlite';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
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
import { setDbInstance } from './persister';

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
        theme: 'light', // Will be updated from persisted value
        device: '', // Will be set after load if empty
        closed_session_access_order: '[]', // JSON array of recently accessed closed session IDs (LRU order)
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
    let persister: any = null;
    let themeListenerId: string | null = null;
    let appearanceSubscription: ReturnType<typeof Appearance.addChangeListener> | null = null;

    async function initialize() {
      try {
        // Reset store to clean state before initialization (important for retry)
        // This ensures we don't have corrupted state from a previous failed attempt
        store.setTables({
          sessions: {},
          messages: {},
          projects: {},
          workstations: {},
          artifacts: {},
        });
        store.setValues({
          theme: 'light',
          device: '',
          closed_session_access_order: '[]',
          active_session_id: '',
        });

        if (Platform.OS === 'web') {
          // Web: Use OPFS persistence
          const { createOpfsPersister } = await import('tinybase/persisters/persister-browser');
          const opfs = await navigator.storage.getDirectory();
          const handle = await opfs.getFileHandle('arc0-store.json', { create: true });
          persister = createOpfsPersister(store, handle);
          await persister.load();
          await persister.startAutoSave();
        } else {
          // Native: Use SQLite with tabular mode
          const database = await SQLite.openDatabaseAsync('arc0.db');
          setDb(database);
          setDbInstance(database); // Make available for direct queries

          // Run migrations FIRST (before persister)
          await runMigrations(database);

          // Create persister with tabular mode
          const { createExpoSqlitePersister } = await import(
            'tinybase/persisters/persister-expo-sqlite'
          );

          persister = createExpoSqlitePersister(store, database, {
            mode: 'tabular',
            tables: {
              load: {
                // Load messages from VIEW (only open session messages)
                open_messages: { tableId: 'messages', rowIdColumnName: 'id' },
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

          // Load once at startup
          await persister.load();

          // AutoSave only (NO autoLoad - it uses setContent() which replaces entire store)
          await persister.startAutoSave();
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
        const syncTheme = () => {
          const preference = store.getValue('theme') as ThemePreference | undefined;
          if (preference) {
            Uniwind.setTheme(resolveTheme(preference));
          }
        };
        syncTheme();
        themeListenerId = store.addValueListener('theme', syncTheme);

        // Listen for system appearance changes when preference is 'system'
        appearanceSubscription = Appearance.addChangeListener(({ colorScheme }) => {
          const preference = store.getValue('theme') as ThemePreference | undefined;
          if (preference === 'system') {
            const resolved = colorScheme === 'dark' ? 'dark' : 'light';
            Uniwind.setTheme(resolved);
          }
        });

        setIsReady(true);
      } catch (err) {
        console.error('[StoreProvider] Initialization failed:', err);
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    }

    initialize();

    return () => {
      // Cleanup listeners and persister on unmount
      if (themeListenerId) {
        store.delListener(themeListenerId);
      }
      if (appearanceSubscription) {
        appearanceSubscription.remove();
      }
      if (persister) {
        persister.stopAutoSave?.();
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
