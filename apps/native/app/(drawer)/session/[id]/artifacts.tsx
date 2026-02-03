import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useGlobalSearchParams, useRouter } from 'expo-router';
import { ExternalLinkIcon, FileCodeIcon, PickaxeIcon, MapIcon } from 'lucide-react-native';
import { useIndexes, useStore } from 'tinybase/ui-react';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { ArtifactChip, ARTIFACT_CHIPS, type ArtifactType } from '@/components/artifacts';
import { MarkdownContent } from '@/components/artifacts';
import { TodoListDisplay } from '@/components/messages/TodoListDisplay';
import { useScrollToMessage } from '@/lib/contexts/ScrollToMessageContext';
import { useArtifacts } from '@/lib/store/useArtifacts';
import { unloadSessionArtifacts } from '@/lib/store/artifacts-loader';

export default function ArtifactsScreen() {
  const { id } = useGlobalSearchParams<{ id: string }>();
  const router = useRouter();
  const store = useStore();
  const indexes = useIndexes();
  const { requestScrollToMessage } = useScrollToMessage();
  const { data: artifacts, isLoading } = useArtifacts(id || '');
  const [selectedType, setSelectedType] = useState<ArtifactType | null>(null);

  // Memory cleanup: unload artifacts when navigating away from this session
  useEffect(() => {
    return () => {
      if (store && indexes && id) {
        unloadSessionArtifacts(store, indexes, id);
      }
    };
  }, [store, indexes, id]);

  const handleViewPlanInChat = () => {
    if (artifacts?.plan?.messageUuid) {
      // Request scroll before navigating
      requestScrollToMessage(artifacts.plan.messageUuid);
      // Navigate to chat tab
      router.push(`/session/${id}/chat`);
    }
  };

  // Count artifacts
  const counts = {
    todo: artifacts?.todos?.length || 0,
    plan: artifacts?.plan ? 1 : 0,
  };

  // Auto-select first available type
  const availableTypes = (['todo', 'plan'] as ArtifactType[]).filter((t) => counts[t] > 0);
  const activeType = selectedType && counts[selectedType] > 0 ? selectedType : availableTypes[0];

  if (isLoading) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <Text className="text-muted-foreground">Loading artifacts...</Text>
      </View>
    );
  }

  if (!artifacts || (counts.todo === 0 && counts.plan === 0)) {
    return (
      <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
        <View className="bg-muted rounded-full p-4">
          <Icon as={FileCodeIcon} className="text-muted-foreground size-8" />
        </View>
        <Text className="text-center text-lg font-medium">No artifacts yet</Text>
        <Text className="text-muted-foreground text-center">
          Plans and tasks will appear here as Claude works
        </Text>
      </View>
    );
  }

  return (
    <View className="bg-background flex-1">
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: 80,
        }}>
        {activeType === 'todo' && artifacts.todos.length > 0 && (
          <View className="border-border rounded-sm border p-4">
            <View className="mb-3 flex-row items-center">
              <Icon as={PickaxeIcon} className="text-muted-foreground size-5" />
              <Text className="text-foreground ml-2 font-semibold">Tasks</Text>
              <Text className="text-muted-foreground ml-auto text-xs">
                {artifacts.todos.filter((t) => t.status === 'completed').length}/
                {artifacts.todos.length} completed
              </Text>
            </View>
            <TodoListDisplay todos={artifacts.todos} />
          </View>
        )}

        {activeType === 'plan' && artifacts.plan && (
          <View className="border-border rounded-sm border p-4">
            <View className="mb-3 flex-row items-center">
              <Icon as={MapIcon} className="text-muted-foreground size-5" />
              <Text className="text-foreground ml-2 font-semibold">Implementation Plan</Text>
              {artifacts.plan.messageUuid && (
                <Pressable
                  onPress={handleViewPlanInChat}
                  className="bg-muted ml-auto flex-row items-center gap-1 rounded-md px-2 py-1 active:opacity-70">
                  <Icon as={ExternalLinkIcon} className="text-muted-foreground size-3" />
                  <Text className="text-muted-foreground text-xs">View in Chat</Text>
                </Pressable>
              )}
            </View>
            {artifacts.plan.content ? (
              <MarkdownContent content={artifacts.plan.content} />
            ) : (
              <Text className="text-muted-foreground">Plan mode exited (no content)</Text>
            )}
          </View>
        )}
      </ScrollView>

      {/* Chip selector at bottom */}
      {availableTypes.length > 1 && (
        <View className="border-border bg-background absolute right-0 bottom-0 left-0 border-t">
          <View className="flex-row justify-center px-4 py-3">
            {ARTIFACT_CHIPS.map((chip) => (
              <ArtifactChip
                key={chip.type}
                chip={chip}
                count={counts[chip.type]}
                selected={activeType === chip.type}
                onPress={() => setSelectedType(chip.type)}
              />
            ))}
          </View>
        </View>
      )}
    </View>
  );
}
