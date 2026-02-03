import { ChevronDownIcon, ChevronRightIcon, DatabaseIcon } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTable } from 'tinybase/ui-react';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';

// TinyBase tables to inspect
const TABLES = ['sessions', 'messages', 'projects', 'workstations'] as const;
type TableName = (typeof TABLES)[number];

// Max rows to show per table (for performance)
const MAX_ROWS_PREVIEW = 20;

// Columns to show in preview for each table (most useful fields first)
const TABLE_PREVIEW_COLUMNS: Record<TableName, string[]> = {
  sessions: ['name', 'first_message', 'open', 'project_id', 'model'],
  messages: ['type', 'session_id', 'stop_reason'],
  projects: ['name', 'starred'],
  workstations: ['name'],
};

interface RowPreviewProps {
  rowId: string;
  row: Record<string, unknown>;
  columns: string[];
}

function RowPreview({ rowId, row, columns }: RowPreviewProps) {
  const [expanded, setExpanded] = useState(false);

  // Preview value - show first available column value
  const previewValue = useMemo(() => {
    for (const col of columns) {
      const val = row[col];
      if (val !== undefined && val !== null && val !== '') {
        const str = typeof val === 'string' ? val : JSON.stringify(val);
        return str.length > 30 ? str.slice(0, 30) + '...' : str;
      }
    }
    return '(empty)';
  }, [row, columns]);

  return (
    <View className="border-border border-b py-1">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center"
        accessibilityRole="button">
        <Icon
          as={expanded ? ChevronDownIcon : ChevronRightIcon}
          className="text-muted-foreground mr-1 size-3"
        />
        <Text className="text-muted-foreground mr-2 font-mono text-xs">{rowId.slice(0, 8)}</Text>
        <Text className="flex-1 text-xs" numberOfLines={1}>
          {previewValue}
        </Text>
      </Pressable>

      {expanded && (
        <View className="bg-muted/30 mt-1 rounded p-2">
          <Text className="text-muted-foreground mb-1 font-mono text-xs">ID: {rowId}</Text>
          {Object.entries(row).map(([key, value]) => {
            const displayValue =
              typeof value === 'string' && value.length > 100
                ? value.slice(0, 100) + '...'
                : typeof value === 'object'
                  ? JSON.stringify(value, null, 2)
                  : String(value ?? '');

            return (
              <View key={key} className="mb-1">
                <Text className="text-muted-foreground text-xs">{key}:</Text>
                <Text className="font-mono text-xs" selectable>
                  {displayValue || '(empty)'}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

interface TableSectionProps {
  tableName: TableName;
}

function TableSection({ tableName }: TableSectionProps) {
  const [expanded, setExpanded] = useState(false);
  // Use reactive hook - component re-renders when table data changes
  const rows = useTable(tableName) as Record<string, Record<string, unknown>>;
  const rowIds = Object.keys(rows);
  const rowCount = rowIds.length;
  const displayIds = rowIds.slice(0, MAX_ROWS_PREVIEW);
  const hasMore = rowCount > MAX_ROWS_PREVIEW;
  const previewColumns = TABLE_PREVIEW_COLUMNS[tableName];

  return (
    <View className="mb-4">
      <Pressable
        onPress={() => setExpanded(!expanded)}
        className="flex-row items-center py-1"
        accessibilityRole="button">
        <Icon
          as={expanded ? ChevronDownIcon : ChevronRightIcon}
          className="text-muted-foreground mr-1 size-4"
        />
        <Icon as={DatabaseIcon} className="text-muted-foreground mr-2 size-4" />
        <Text className="flex-1 font-medium">{tableName}</Text>
        <Text className="text-muted-foreground text-xs">
          {rowCount} row{rowCount !== 1 ? 's' : ''}
        </Text>
      </Pressable>

      {expanded && (
        <View className="mt-1 ml-6">
          {rowCount === 0 ? (
            <Text className="text-muted-foreground text-xs italic">No rows</Text>
          ) : (
            <>
              {displayIds.map((rowId) => (
                <RowPreview key={rowId} rowId={rowId} row={rows[rowId]} columns={previewColumns} />
              ))}
              {hasMore && (
                <Text className="text-muted-foreground mt-1 text-center text-xs">
                  ... and {rowCount - MAX_ROWS_PREVIEW} more rows
                </Text>
              )}
            </>
          )}
        </View>
      )}
    </View>
  );
}

/**
 * Store Inspector - Browse TinyBase store contents.
 * Shows tables with expandable rows for debugging.
 * Each TableSection uses useTable() for reactive updates.
 */
export function StoreInspector() {
  return (
    <View>
      <Text className="text-muted-foreground mb-2 text-xs font-medium tracking-wide uppercase">
        Store Inspector
      </Text>
      <Text className="text-muted-foreground mb-3 text-xs">
        Browse TinyBase store tables and rows. Tap to expand.
      </Text>

      {TABLES.map((tableName) => (
        <TableSection key={tableName} tableName={tableName} />
      ))}
    </View>
  );
}
