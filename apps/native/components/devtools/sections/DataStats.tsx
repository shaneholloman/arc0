import { useEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import { useStore } from 'tinybase/ui-react';

import { Text } from '@/components/ui/text';
import { useStoreContext } from '@/lib/store/provider';

interface SQLiteStats {
  count: number;
  latest: string | null;
}

interface StoreSizes {
  sqliteBytes: number | null;
  tinybaseBytes: number | null;
}

// TinyBase tables
const TINYBASE_TABLES = ['sessions', 'messages', 'projects', 'workstations'] as const;

// SQLite tables (includes tinybase_values which is auto-managed)
const SQLITE_TABLES = [
  'sessions',
  'messages',
  'projects',
  'workstations',
  'tinybase_values',
] as const;

// SQLite views
const SQLITE_VIEWS = ['open_sessions', 'open_messages'] as const;

// TinyBase values (preferences)
const TINYBASE_VALUES = ['theme', 'device'] as const;

/**
 * Displays combined TinyBase and SQLite stats in a unified table view.
 */
export function DataStats() {
  const store = useStore();
  const { db, isReady } = useStoreContext();
  const [sqliteTableStats, setSqliteTableStats] = useState<Record<string, SQLiteStats>>({});
  const [sqliteViewStats, setSqliteViewStats] = useState<Record<string, SQLiteStats>>({});
  const [storeSizes, setStoreSizes] = useState<StoreSizes>({
    sqliteBytes: null,
    tinybaseBytes: null,
  });
  const [loading, setLoading] = useState(Platform.OS !== 'web');

  // Calculate TinyBase store size (estimate via JSON serialization)
  useEffect(() => {
    if (!store) return;
    try {
      const content = store.getContent();
      const json = JSON.stringify(content);
      setStoreSizes((prev) => ({ ...prev, tinybaseBytes: new Blob([json]).size }));
    } catch {
      setStoreSizes((prev) => ({ ...prev, tinybaseBytes: null }));
    }
  }, [store]);

  // Fetch SQLite stats
  useEffect(() => {
    if (Platform.OS === 'web' || !db || !isReady) return;

    async function fetchStats() {
      const tableResults: Record<string, SQLiteStats> = {};
      const viewResults: Record<string, SQLiteStats> = {};

      // Get database size using PRAGMA
      try {
        const sizeResult = await db!.getFirstAsync<{ size: number }>(
          `SELECT (SELECT page_count FROM pragma_page_count) * (SELECT page_size FROM pragma_page_size) as size`
        );
        setStoreSizes((prev) => ({ ...prev, sqliteBytes: sizeResult?.size ?? null }));
      } catch {
        setStoreSizes((prev) => ({ ...prev, sqliteBytes: null }));
      }

      // Fetch table stats
      for (const table of SQLITE_TABLES) {
        try {
          // tinybase_values doesn't have updated_at column
          const hasTimestamp = table !== 'tinybase_values';
          const query = hasTimestamp
            ? `SELECT COUNT(*) as count, MAX(updated_at) as latest FROM ${table}`
            : `SELECT COUNT(*) as count, NULL as latest FROM ${table}`;

          const result = await db!.getFirstAsync<{ count: number; latest: string | null }>(query);
          tableResults[table] = {
            count: result?.count ?? 0,
            latest: result?.latest ?? null,
          };
        } catch {
          tableResults[table] = { count: 0, latest: null };
        }
      }

      // Fetch view stats
      for (const view of SQLITE_VIEWS) {
        try {
          const result = await db!.getFirstAsync<{ count: number; latest: string | null }>(
            `SELECT COUNT(*) as count, MAX(updated_at) as latest FROM ${view}`
          );
          viewResults[view] = {
            count: result?.count ?? 0,
            latest: result?.latest ?? null,
          };
        } catch {
          viewResults[view] = { count: 0, latest: null };
        }
      }

      setSqliteTableStats(tableResults);
      setSqliteViewStats(viewResults);
      setLoading(false);
    }

    fetchStats();
  }, [db, isReady]);

  // Format bytes to human readable
  const formatBytes = (bytes: number | null): string => {
    if (bytes === null) return '-';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // Format timestamp to short time
  const formatTime = (timestamp: string | null): string => {
    if (!timestamp) return '-';
    try {
      return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '-';
    }
  };

  // Get TinyBase table count
  const getTinyBaseCount = (table: string): number => {
    return Object.keys(store?.getTable(table) || {}).length;
  };

  // Get TinyBase table's latest timestamp from row data
  // Different tables have different timestamp fields:
  // - messages: 'timestamp'
  // - sessions: 'last_message_at' or 'started_at'
  // - projects/workstations: no timestamp fields
  const getTinyBaseLatest = (table: string): string | null => {
    const rows = store?.getTable(table);
    if (!rows) return null;

    let latest: string | null = null;
    for (const row of Object.values(rows)) {
      const r = row as Record<string, unknown>;
      let ts: string | null = null;

      if (table === 'messages') {
        ts = typeof r.timestamp === 'string' ? r.timestamp : null;
      } else if (table === 'sessions') {
        // Prefer last_message_at, fall back to started_at
        ts =
          typeof r.last_message_at === 'string' && r.last_message_at
            ? r.last_message_at
            : typeof r.started_at === 'string'
              ? r.started_at
              : null;
      }
      // projects and workstations don't have timestamp fields in TinyBase

      if (ts && (!latest || ts > latest)) {
        latest = ts;
      }
    }
    return latest;
  };

  // Get TinyBase value
  const getTinyBaseValue = (key: string): string => {
    const value = store?.getValue(key);
    if (value === undefined || value === null || value === '') return '-';
    return String(value);
  };

  const isWeb = Platform.OS === 'web';

  return (
    <View>
      {/* Size Section */}
      <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        Storage
      </Text>
      <View className="mb-3">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs">TinyBase (in-memory)</Text>
          <Text className="font-mono text-xs">{formatBytes(storeSizes.tinybaseBytes)}</Text>
        </View>
        {!isWeb && (
          <View className="flex-row items-center justify-between">
            <Text className="text-xs">SQLite (arc0.db)</Text>
            <Text className="font-mono text-xs">{formatBytes(storeSizes.sqliteBytes)}</Text>
          </View>
        )}
      </View>

      {/* Tables Section */}
      <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        Tables
      </Text>
      <View className="border-border mb-1 flex-row items-center border-b pb-1">
        <Text className="text-muted-foreground w-28 text-xs">Name</Text>
        <Text className="text-muted-foreground w-8 text-center text-xs">Tiny</Text>
        <Text className="text-muted-foreground w-12 text-right text-xs">ts</Text>
        {!isWeb && (
          <>
            <Text className="text-muted-foreground w-8 text-center text-xs">SQL</Text>
            <Text className="text-muted-foreground w-12 text-right text-xs">ts</Text>
          </>
        )}
      </View>
      {loading ? (
        <Text className="text-muted-foreground text-xs">Loading...</Text>
      ) : (
        <View className="mb-3">
          {SQLITE_TABLES.map((table) => {
            const hasTinyBase = TINYBASE_TABLES.includes(table as (typeof TINYBASE_TABLES)[number]);
            const tinyCount = hasTinyBase ? getTinyBaseCount(table) : null;
            const tinyLatest = hasTinyBase ? getTinyBaseLatest(table) : null;
            const sqliteData = sqliteTableStats[table];

            return (
              <View key={table} className="flex-row items-center py-0.5">
                <Text className="w-28 text-xs" numberOfLines={1}>
                  {table}
                </Text>
                <Text className="w-8 text-center text-xs">
                  {tinyCount !== null ? tinyCount : '-'}
                </Text>
                <Text className="text-muted-foreground w-12 text-right text-xs">
                  {formatTime(tinyLatest)}
                </Text>
                {!isWeb && (
                  <>
                    <Text className="w-8 text-center text-xs">{sqliteData?.count ?? '-'}</Text>
                    <Text className="text-muted-foreground w-12 text-right text-xs">
                      {formatTime(sqliteData?.latest ?? null)}
                    </Text>
                  </>
                )}
              </View>
            );
          })}
        </View>
      )}

      {/* Views Section */}
      {!isWeb && !loading && (
        <>
          <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
            Views
          </Text>
          <View className="border-border mb-1 flex-row items-center border-b pb-1">
            <Text className="text-muted-foreground flex-1 text-xs">Name</Text>
            <Text className="text-muted-foreground w-8 text-center text-xs">Rows</Text>
            <Text className="text-muted-foreground w-12 text-right text-xs">ts</Text>
          </View>
          <View className="mb-3">
            {SQLITE_VIEWS.map((view) => {
              const viewData = sqliteViewStats[view];
              return (
                <View key={view} className="flex-row items-center py-0.5">
                  <Text className="flex-1 text-xs">{view}</Text>
                  <Text className="w-8 text-center text-xs">{viewData?.count ?? '-'}</Text>
                  <Text className="text-muted-foreground w-12 text-right text-xs">
                    {formatTime(viewData?.latest ?? null)}
                  </Text>
                </View>
              );
            })}
          </View>
        </>
      )}

      {/* Values/Preferences Section */}
      <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        Values
      </Text>
      <View className="border-border mb-1 flex-row items-center border-b pb-1">
        <Text className="text-muted-foreground flex-1 text-xs">Key</Text>
        <Text className="text-muted-foreground flex-1 text-right text-xs">Value</Text>
      </View>
      <View>
        {TINYBASE_VALUES.map((key) => (
          <View key={key} className="flex-row items-center py-0.5">
            <Text className="flex-1 text-xs">{key}</Text>
            <Text className="flex-1 text-right font-mono text-xs" numberOfLines={1}>
              {getTinyBaseValue(key)}
            </Text>
          </View>
        ))}
      </View>

      {isWeb && (
        <Text className="text-muted-foreground mt-2 text-xs">
          SQLite stats not available on web (uses OPFS)
        </Text>
      )}
    </View>
  );
}
