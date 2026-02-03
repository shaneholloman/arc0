import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { useIndexes, useRow, useStore } from 'tinybase/ui-react';

import { loadSessionArtifacts, areArtifactsLoaded } from '@/lib/store/artifacts-loader';
import {
  parseTodosContent,
  parsePlanContent,
  type TodoItem,
} from '@/lib/socket/artifact-extractor';

export interface ExtractedPlan {
  content: string | null;
  allowedPrompts: unknown[];
  messageUuid: string;
}

export interface ExtractedArtifacts {
  todos: TodoItem[];
  plan: ExtractedPlan | null;
}

/**
 * Hook to get artifacts for a session.
 * Loads artifacts from SQLite into TinyBase on demand.
 * Returns reactive data that updates when artifacts change.
 */
export function useArtifacts(sessionId: string): {
  data: ExtractedArtifacts | null;
  isLoading: boolean;
  reload: () => Promise<void>;
} {
  const store = useStore();
  const indexes = useIndexes();
  const [isLoading, setIsLoading] = useState(false);
  const [loadAttempted, setLoadAttempted] = useState(false);

  // Get artifact rows from TinyBase using index
  const todosArtifactId = `${sessionId}:todos`;
  const planArtifactId = `${sessionId}:plan`;

  const todosRow = useRow('artifacts', todosArtifactId, store);
  const planRow = useRow('artifacts', planArtifactId, store);

  // Load artifacts on demand if not already loaded
  const loadArtifacts = useCallback(async () => {
    // Skip on web - OPFS persists entire store including artifacts
    // SQLite-based loading is only needed on native
    if (Platform.OS === 'web') {
      setLoadAttempted(true);
      return;
    }

    if (!store || !indexes || !sessionId || isLoading) return;

    // Check if already loaded
    if (areArtifactsLoaded(indexes, sessionId)) {
      return;
    }

    setIsLoading(true);
    try {
      await loadSessionArtifacts(store, indexes, sessionId);
    } catch (error) {
      console.error('[useArtifacts] Failed to load artifacts:', error);
    } finally {
      setIsLoading(false);
      setLoadAttempted(true);
    }
  }, [store, indexes, sessionId, isLoading]);

  // Attempt to load on mount or when sessionId changes
  useEffect(() => {
    if (sessionId && store && indexes && !loadAttempted) {
      loadArtifacts();
    }
  }, [sessionId, store, indexes, loadAttempted, loadArtifacts]);

  // Reset load attempted when sessionId changes
  useEffect(() => {
    setLoadAttempted(false);
  }, [sessionId]);

  // Transform TinyBase rows to ExtractedArtifacts
  const artifacts = useMemo((): ExtractedArtifacts | null => {
    const hasTodos = todosRow && Object.keys(todosRow).length > 0;
    const hasPlan = planRow && Object.keys(planRow).length > 0;

    if (!hasTodos && !hasPlan) {
      return null;
    }

    // Parse todos
    let todos: TodoItem[] = [];
    if (hasTodos && typeof todosRow.content === 'string') {
      todos = parseTodosContent(todosRow.content);
    }

    // Parse plan
    let plan: ExtractedPlan | null = null;
    if (hasPlan && typeof planRow.content === 'string') {
      const parsed = parsePlanContent(planRow.content);
      plan = {
        content: parsed.plan,
        allowedPrompts: parsed.allowedPrompts,
        messageUuid: (planRow.source_message_id as string) || '',
      };
    }

    return { todos, plan };
  }, [todosRow, planRow]);

  return {
    data: artifacts,
    isLoading,
    reload: loadArtifacts,
  };
}
