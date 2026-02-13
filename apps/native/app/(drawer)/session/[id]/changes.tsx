import { FileChangeRow } from '@/components/changes';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { FileChangeItem } from '@/lib/types/session';
import { useLocalSearchParams } from 'expo-router';
import {
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  GitBranchIcon,
  GitCompareIcon,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

// Mock data for development - showcases file type icons
const MOCK_CHANGES: FileChangeItem[] = [
  // AI/LLM Config Files
  {
    id: '1',
    path: 'CLAUDE.md',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:40:00Z',
    staged: true,
  },
  {
    id: '2',
    path: 'GEMINI.md',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:39:00Z',
    staged: true,
  },
  {
    id: '3',
    path: 'AGENTS.md',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:38:00Z',
    staged: true,
  },
  {
    id: '4',
    path: 'Codex.md',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:37:00Z',
    staged: true,
  },
  // Environment & Config
  {
    id: '5',
    path: '.env',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:36:00Z',
    staged: true,
  },
  {
    id: '6',
    path: '.env.local',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:35:00Z',
    staged: true,
  },
  // JavaScript/TypeScript
  {
    id: '7',
    path: 'src/components/Button.tsx',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:34:00Z',
    staged: false,
  },
  {
    id: '8',
    path: 'src/utils/helpers.ts',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:33:00Z',
    staged: false,
  },
  {
    id: '9',
    path: 'src/index.js',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:32:00Z',
    staged: false,
  },
  // Styles
  {
    id: '10',
    path: 'src/styles/main.css',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:31:00Z',
    staged: false,
  },
  {
    id: '11',
    path: 'tailwind.config.js',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:30:00Z',
    staged: false,
  },
  // Package Managers
  {
    id: '12',
    path: 'package.json',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:29:00Z',
    staged: false,
  },
  {
    id: '13',
    path: 'pnpm-lock.yaml',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:28:00Z',
    staged: false,
  },
  {
    id: '14',
    path: 'pnpm-workspace.yaml',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:27:00Z',
    staged: false,
  },
  // Data Files
  {
    id: '15',
    path: 'data/users.csv',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:26:00Z',
    staged: false,
  },
  {
    id: '16',
    path: 'data/app.db',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:25:00Z',
    staged: false,
  },
  {
    id: '17',
    path: 'config.json',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:24:00Z',
    staged: false,
  },
  // DevOps
  {
    id: '18',
    path: 'Dockerfile',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:23:00Z',
    staged: false,
  },
  {
    id: '19',
    path: 'docker-compose.yml',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:22:00Z',
    staged: false,
  },
  // Mobile
  {
    id: '20',
    path: 'ios/App.swift',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:21:00Z',
    staged: false,
  },
  {
    id: '21',
    path: 'android/Activity.kt',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:20:00Z',
    staged: false,
  },
  // Backend
  {
    id: '22',
    path: 'cmd/server/main.go',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:19:00Z',
    staged: false,
  },
  {
    id: '23',
    path: 'scripts/process.py',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:18:00Z',
    staged: false,
  },
  // Git & Shell
  {
    id: '24',
    path: '.gitignore',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:17:00Z',
    staged: false,
  },
  {
    id: '25',
    path: '.gitattributes',
    operation: 'create',
    diff: '@@ -0,0 +1 @@\n+new',
    timestamp: '2024-01-10T10:16:00Z',
    staged: false,
  },
  {
    id: '26',
    path: 'scripts/deploy.sh',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:15:00Z',
    staged: false,
  },
  // Documentation
  {
    id: '27',
    path: 'README.md',
    operation: 'edit',
    diff: '@@ -1 +1 @@\n-old\n+new',
    timestamp: '2024-01-10T10:14:00Z',
    staged: false,
  },
];

export default function ChangesScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set((typeof window !== 'undefined' && (window as any).__ARC0_MOCK_CHANGES_EXPANDED__) || [])
  );
  const [allExpanded, setAllExpanded] = useState(false);
  const [overlayDismissed, setOverlayDismissed] = useState(false);

  // Dev override: inject data via window global
  const changes: FileChangeItem[] =
    (typeof window !== 'undefined' && (window as any).__ARC0_MOCK_CHANGES__) || MOCK_CHANGES;

  const { stagedChanges, unstagedChanges } = useMemo(() => {
    const staged = changes.filter((c) => c.staged);
    const unstaged = changes.filter((c) => !c.staged);
    return { stagedChanges: staged, unstagedChanges: unstaged };
  }, [changes]);

  function toggleExpanded(changeId: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(changeId)) {
        next.delete(changeId);
      } else {
        next.add(changeId);
      }
      return next;
    });
  }

  function toggleAllExpanded() {
    if (allExpanded) {
      setExpandedIds(new Set());
      setAllExpanded(false);
    } else {
      setExpandedIds(new Set(changes.map((c) => c.id)));
      setAllExpanded(true);
    }
  }

  // Empty state
  if (changes.length === 0) {
    return (
      <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
        <View className="bg-muted rounded-full p-4">
          <Icon as={GitCompareIcon} className="text-muted-foreground size-8" />
        </View>
        <Text className="text-center text-lg font-medium">No changes yet</Text>
        <Text className="text-muted-foreground text-center">
          File changes made during this session will appear here.
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-background flex-1">
      {/* Existing mocked view (visible in background) */}
      <View className="flex-1">
        {/* Header with expand/collapse all */}
        <View className="flex-row items-center justify-between px-4 py-3">
          <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Files Changed ({changes.length})
          </Text>
          <Pressable
            onPress={toggleAllExpanded}
            className="flex-row items-center gap-1 active:opacity-70">
            <Text className="text-muted-foreground text-xs">
              {allExpanded ? 'Collapse' : 'Expand'} all
            </Text>
            <Icon
              as={allExpanded ? ChevronsDownUpIcon : ChevronsUpDownIcon}
              className="text-muted-foreground size-4"
            />
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={{
            paddingHorizontal: 16,
            paddingBottom: 16,
          }}
          showsVerticalScrollIndicator={false}>
          {/* Staged Changes */}
          {stagedChanges.length > 0 && (
            <View className="mb-4">
              <Text className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                Staged Changes ({stagedChanges.length})
              </Text>
              {stagedChanges.map((item) => (
                <FileChangeRow
                  key={item.id}
                  change={item}
                  expanded={expandedIds.has(item.id)}
                  onToggle={() => toggleExpanded(item.id)}
                />
              ))}
            </View>
          )}

          {/* Unstaged Changes */}
          {unstagedChanges.length > 0 && (
            <View>
              <Text className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide uppercase">
                Unstaged Changes ({unstagedChanges.length})
              </Text>
              {unstagedChanges.map((item) => (
                <FileChangeRow
                  key={item.id}
                  change={item}
                  expanded={expandedIds.has(item.id)}
                  onToggle={() => toggleExpanded(item.id)}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </View>

      {/* Coming Soon Overlay */}
      {!overlayDismissed && (
        <Pressable
          onPress={() => setOverlayDismissed(true)}
          className="bg-background/80 absolute inset-0 items-center justify-center">
          <View className="items-center gap-4 p-6">
            <View className="bg-muted rounded-full p-4">
              <Icon as={GitBranchIcon} className="text-muted-foreground size-8" />
            </View>
            <Text className="text-center text-xl font-semibold">Coming Soon</Text>
            <Text className="text-muted-foreground max-w-xs text-center">
              Git integration is on the way. View diffs, stage changes, and commit directly from the
              app.
            </Text>
          </View>
        </Pressable>
      )}
    </View>
  );
}
