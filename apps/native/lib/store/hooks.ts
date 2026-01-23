/**
 * TinyBase React hooks for UI data access.
 * Replaces React Query hooks with reactive TinyBase subscriptions.
 */

import { useCallback, useMemo, useRef, useState, useEffect } from 'react';
import { Platform } from 'react-native';
import {
  useIndexes,
  useRow,
  useSliceRowIds,
  useStore,
  useTable,
  useValue,
} from 'tinybase/ui-react';

import type { ContentBlock, Message, Session } from '@/lib/types/session';
import type { SessionStatus, StatusInfo } from '@/lib/types/session-status';
import { useUserActionsSafe } from '@/lib/contexts/UserActionsContext';
import { loadClosedSessionMessages, recordClosedSessionAccess } from './closed-sessions';
import type { ThemePreference } from './core';
import { resolveTheme } from './core';
import { useStoreContext } from './provider';

// =============================================================================
// Types
// =============================================================================

/**
 * TinyBase store row format for sessions (snake_case).
 */
interface SessionRow {
  name?: string;
  first_message?: string;
  provider?: string;
  project_id?: string;
  workstation_id?: string;
  model?: string;
  git_branch?: string;
  started_at?: string;
  ended_at?: string;
  message_count?: number;
  last_message_at?: string;
  open?: number; // 1 = open, 0 = closed
  status?: string; // SessionStatus type
  status_detail?: string; // Human-readable status label
}

/**
 * TinyBase store row format for messages (snake_case).
 */
interface MessageRow {
  session_id?: string;
  parent_id?: string;
  type?: string;
  timestamp?: string;
  content?: string; // JSON string
  stop_reason?: string;
  usage?: string; // JSON string
}

/**
 * TinyBase store row format for projects.
 */
interface ProjectRow {
  workstation_id?: string;
  path?: string; // Full working directory path
  name?: string;
  starred?: number; // 0 or 1
  created_at?: string;
  updated_at?: string;
}

// =============================================================================
// Transformation Utilities
// =============================================================================

/**
 * Transform TinyBase session row to UI Session type.
 * @param projectPath - Full project path for display (UI handles truncation)
 */
function transformSession(id: string, row: SessionRow, projectPath?: string): Session {
  return {
    id,
    name: row.name ?? null,
    projectName: projectPath ?? row.project_id ?? 'Unknown Project',
    providerId: row.provider ?? 'claude',
    model: row.model ?? null,
    gitBranch: row.git_branch ?? null,
    startedAt: row.started_at ?? new Date().toISOString(),
    endedAt: row.ended_at ?? null,
    messageCount: row.message_count ?? 0,
    lastMessageAt: row.last_message_at ?? null,
    status: (row.status as SessionStatus) ?? 'idle',
    statusDetail: row.status_detail ?? 'Ready',
  };
}

/**
 * Transform TinyBase message row to UI Message type.
 * Parses JSON strings for content and usage.
 */
function transformMessage(id: string, row: MessageRow): Message {
  // Parse content from JSON string
  let content: ContentBlock[] = [];
  if (row.content) {
    try {
      content = JSON.parse(row.content);
    } catch {
      console.warn('[hooks] Failed to parse message content:', id);
    }
  }

  // Parse usage from JSON string
  let usage: { inputTokens: number; outputTokens: number } | undefined;
  if (row.usage && row.usage !== '{}') {
    try {
      usage = JSON.parse(row.usage);
    } catch {
      console.warn('[hooks] Failed to parse message usage:', id);
    }
  }

  return {
    uuid: id,
    parentUuid: row.parent_id || null,
    sessionId: row.session_id ?? '',
    timestamp: row.timestamp ?? new Date().toISOString(),
    type: (row.type as 'user' | 'assistant') ?? 'user',
    content,
    stopReason: row.stop_reason as 'end_turn' | 'tool_use' | null | undefined,
    usage,
  };
}

// =============================================================================
// Theme Hook
// =============================================================================

/**
 * Get and set the current theme preference.
 * System appearance changes are handled by StoreProvider.
 */
export function useTheme(): { theme: ThemePreference; setTheme: (theme: ThemePreference) => void } {
  const store = useStore();
  const themeValue = useValue('theme') as ThemePreference | undefined;

  const setTheme = useCallback(
    (newTheme: ThemePreference) => {
      store?.setValue('theme', newTheme);
    },
    [store]
  );

  return {
    theme: themeValue ?? 'light',
    setTheme,
  };
}

/**
 * Toggle between light and dark theme.
 * If current preference is 'system', toggles based on resolved theme.
 */
export function useToggleTheme(): () => void {
  const store = useStore();
  const themeValue = useValue('theme') as ThemePreference | undefined;

  return useCallback(() => {
    const current = themeValue ?? 'light';
    const resolved = resolveTheme(current);
    store?.setValue('theme', resolved === 'dark' ? 'light' : 'dark');
  }, [store, themeValue]);
}

// =============================================================================
// Session Hooks
// =============================================================================

/**
 * Get all sessions from the store.
 */
export function useSessions(): Session[] {
  const sessionsTable = useTable('sessions') as Record<string, SessionRow>;
  const projectsTable = useTable('projects') as Record<string, ProjectRow>;

  return useMemo(() => {
    return Object.entries(sessionsTable).map(([id, row]) => {
      // Use path as display name (name field reserved for future user-defined names)
      const projectPath = row.project_id ? projectsTable[row.project_id]?.path : undefined;
      return transformSession(id, row, projectPath);
    });
  }, [sessionsTable, projectsTable]);
}

/**
 * Get open sessions using TinyBase table subscription.
 * Sorted by last_message_at (most recent first).
 * Filtered by active workstation (multi-workstation support).
 *
 * Note: Uses useTable('sessions') instead of useSliceRowIds to ensure
 * reactivity when session metadata (message_count, last_message_at) changes.
 */
export function useOpenSessions(): Session[] {
  const sessionsTable = useTable('sessions') as Record<string, SessionRow>;
  const projectsTable = useTable('projects') as Record<string, ProjectRow>;
  const workstationsTable = useTable('workstations') as Record<string, { active?: number }>;

  // Find active workstation ID
  const activeWorkstationId = useMemo(() => {
    for (const [id, row] of Object.entries(workstationsTable)) {
      if (row.active === 1) {
        return id;
      }
    }
    return null;
  }, [workstationsTable]);

  return useMemo(() => {
    const sessions = Object.entries(sessionsTable)
      .filter(([_, row]) => {
        // Filter by open status
        if (Number(row.open) !== 1) return false;
        // Filter by active workstation (if any workstations exist)
        if (activeWorkstationId && row.workstation_id !== activeWorkstationId) {
          return false;
        }
        return true;
      })
      .map(([id, row]) => {
        // Use path as display name (name field reserved for future user-defined names)
        const projectPath = row.project_id ? projectsTable[row.project_id]?.path : undefined;
        return transformSession(id, row, projectPath);
      })
      .sort((a, b) => {
        // Sort by last_message_at descending (most recent first)
        // Use || instead of ?? to handle empty strings
        const aTime = a.lastMessageAt || a.startedAt;
        const bTime = b.lastMessageAt || b.startedAt;
        return bTime.localeCompare(aTime);
      });

    return sessions;
  }, [sessionsTable, projectsTable, activeWorkstationId]);
}

/**
 * Get closed sessions using TinyBase table subscription.
 * Sorted by ended_at (most recent first).
 * Filtered by active workstation (multi-workstation support).
 *
 * Note: Uses useTable('sessions') instead of useSliceRowIds to ensure
 * reactivity when session metadata changes.
 */
export function useClosedSessions(): Session[] {
  const sessionsTable = useTable('sessions') as Record<string, SessionRow>;
  const projectsTable = useTable('projects') as Record<string, ProjectRow>;
  const workstationsTable = useTable('workstations') as Record<string, { active?: number }>;

  // Find active workstation ID
  const activeWorkstationId = useMemo(() => {
    for (const [id, row] of Object.entries(workstationsTable)) {
      if (row.active === 1) {
        return id;
      }
    }
    return null;
  }, [workstationsTable]);

  return useMemo(() => {
    const sessions = Object.entries(sessionsTable)
      .filter(([_, row]) => {
        // Filter by closed status
        if (Number(row.open) !== 0) return false;
        // Filter by active workstation (if any workstations exist)
        if (activeWorkstationId && row.workstation_id !== activeWorkstationId) {
          return false;
        }
        return true;
      })
      .map(([id, row]) => {
        // Use path as display name (name field reserved for future user-defined names)
        const projectPath = row.project_id ? projectsTable[row.project_id]?.path : undefined;
        return transformSession(id, row, projectPath);
      })
      .sort((a, b) => {
        // Sort by ended_at descending (most recent first)
        // Use || instead of ?? to handle empty strings
        const aTime = a.endedAt || a.lastMessageAt || a.startedAt;
        const bTime = b.endedAt || b.lastMessageAt || b.startedAt;
        return bTime.localeCompare(aTime);
      });

    return sessions;
  }, [sessionsTable, projectsTable, activeWorkstationId]);
}

/**
 * Get a single session by ID.
 */
export function useSession(sessionId: string): Session | null {
  const row = useRow('sessions', sessionId) as SessionRow;
  const projectsTable = useTable('projects') as Record<string, ProjectRow>;

  return useMemo(() => {
    // Check if the row exists (has any data)
    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    // Use path as display name (name field reserved for future user-defined names)
    const projectPath = row.project_id ? projectsTable[row.project_id]?.path : undefined;
    return transformSession(sessionId, row, projectPath);
  }, [sessionId, row, projectsTable]);
}

/**
 * Combines message-based status with action-based status.
 * Action statuses (sending/submitting) take priority when in-flight for this session.
 *
 * Priority order:
 * 1. ended - session is closed
 * 2. sending - sendPrompt in-flight for this session
 * 3. submitting - other action in-flight for this session
 * 4. message-based status (thinking, ask_user, plan_approval, tool_approval, working, idle)
 */
export function useEffectiveSessionStatus(session: Session): StatusInfo {
  const actionsContext = useUserActionsSafe();

  return useMemo(() => {
    // If session is ended, always show ended
    if (session.status === 'ended') {
      return { status: 'ended', label: 'Ended', isAnimated: false };
    }

    // If no actions context (outside provider), fall back to message-based status
    if (!actionsContext) {
      const animatedStatuses = ['sending', 'submitting', 'thinking', 'working'];
      return {
        status: session.status,
        label: session.statusDetail,
        isAnimated: animatedStatuses.includes(session.status),
      };
    }

    const { actionStates } = actionsContext;

    // Check if sendPrompt is in-flight for this session
    if (actionStates.sendPrompt.isLoading && actionStates.sendPrompt.sessionId === session.id) {
      return { status: 'sending', label: 'Sending...', isAnimated: true };
    }

    // Check if approveToolUse (unified tool response action) is in-flight for this session
    if (actionStates.approveToolUse.isLoading && actionStates.approveToolUse.sessionId === session.id) {
      return { status: 'submitting', label: 'Submitting...', isAnimated: true };
    }

    // Fall back to message-based status from session
    const animatedStatuses = ['sending', 'submitting', 'thinking', 'working'];
    return {
      status: session.status,
      label: session.statusDetail,
      isAnimated: animatedStatuses.includes(session.status),
    };
  }, [session.id, session.status, session.statusDetail, actionsContext]);
}

// =============================================================================
// Message Hooks
// =============================================================================

/**
 * Result type for useMessageIds hook.
 */
interface UseMessageIdsResult {
  /** Sorted message IDs for the session */
  ids: string[];
  /** True when loading closed session messages from SQLite */
  isLoadingMessages: boolean;
}

/**
 * Get sorted message IDs for a session.
 * Handles both open and closed sessions by loading from SQLite on demand.
 *
 * Returns IDs only for optimal reactivity - use useMessage() for each item.
 */
export function useMessageIds(sessionId: string): UseMessageIdsResult {
  const indexes = useIndexes();
  const store = useStore();
  const { db } = useStoreContext();
  const session = useRow('sessions', sessionId) as SessionRow;
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  // Track which sessions we've already attempted to load (prevents infinite loop for empty sessions)
  const attemptedLoadRef = useRef<Set<string>>(new Set());

  // Get message IDs from index
  const messageIds = useSliceRowIds('messagesBySession', sessionId, indexes);

  // Clear attempted load tracking when navigating away from a session
  // This allows re-trying if the user navigates away and back
  useEffect(() => {
    return () => {
      // Cleanup: remove this sessionId from tracking when unmounting or sessionId changes
      attemptedLoadRef.current.delete(sessionId);
    };
  }, [sessionId]);

  // Load closed session messages on demand
  useEffect(() => {
    async function loadIfNeeded() {
      // Skip on web - OPFS persists entire store including all messages
      // SQLite-based loading is only needed on native where we use the open_messages view
      if (Platform.OS === 'web') {
        return;
      }

      // Only load if:
      // - Session is closed
      // - No messages yet in store
      // - We haven't already attempted to load this session
      // - Not currently loading
      const hasAttempted = attemptedLoadRef.current.has(sessionId);
      if (
        session &&
        Number(session.open) === 0 &&
        messageIds.length === 0 &&
        store &&
        indexes &&
        !isLoadingMessages &&
        !hasAttempted
      ) {
        attemptedLoadRef.current.add(sessionId);
        setIsLoadingMessages(true);
        try {
          const loaded = await loadClosedSessionMessages(store, indexes, sessionId);
          if (loaded) {
            // Track access for LRU eviction of other closed sessions
            recordClosedSessionAccess(store, indexes, sessionId);
          }
        } finally {
          setIsLoadingMessages(false);
        }
      }
    }

    loadIfNeeded();
  }, [sessionId, session?.open, messageIds.length, store, indexes, db, isLoadingMessages]);

  // Track access for closed sessions that are already in memory (re-navigation)
  // This keeps the LRU order updated when user navigates back to a previously viewed session
  // Only runs if the first effect didn't handle this session (messages were already loaded)
  // Skip on web - LRU eviction is for native memory management with SQLite
  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    // Skip if first effect already handled this session (it records access after loading)
    const wasLoadedByFirstEffect = attemptedLoadRef.current.has(sessionId);
    if (
      !wasLoadedByFirstEffect &&
      Number(session?.open) === 0 &&
      messageIds.length > 0 &&
      store &&
      indexes
    ) {
      recordClosedSessionAccess(store, indexes, sessionId);
    }
  }, [sessionId, session?.open, messageIds.length, store, indexes]);

  // Sort by timestamp
  const sortedIds = useMemo(() => {
    if (!store) return [];

    return [...messageIds].sort((a, b) => {
      const msgA = store.getRow('messages', a) as MessageRow;
      const msgB = store.getRow('messages', b) as MessageRow;
      return (msgA.timestamp ?? '').localeCompare(msgB.timestamp ?? '');
    });
  }, [messageIds, store]);

  return { ids: sortedIds, isLoadingMessages };
}

/**
 * Get a single message by ID.
 * Transforms from TinyBase format to UI Message type.
 */
export function useMessage(messageId: string): Message | null {
  const row = useRow('messages', messageId) as MessageRow;

  return useMemo(() => {
    // Check if the row exists (has any data)
    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    return transformMessage(messageId, row);
  }, [messageId, row]);
}

/**
 * Result type for useMessages hook.
 */
interface UseMessagesResult {
  /** Messages for the session */
  messages: Message[];
  /** True when loading closed session messages from SQLite */
  isLoadingMessages: boolean;
}

/**
 * Get all messages for a session.
 * Convenience hook that combines useMessageIds + useMessage for each.
 *
 * NOTE: For large message lists, prefer using useMessageIds + individual
 * useMessage calls in each MessageItem component for granular reactivity.
 */
export function useMessages(sessionId: string): UseMessagesResult {
  const store = useStore();
  const { ids: messageIds, isLoadingMessages } = useMessageIds(sessionId);

  const messages = useMemo(() => {
    if (!store) return [];

    return messageIds.map((id) => {
      const row = store.getRow('messages', id) as MessageRow;
      return transformMessage(id, row);
    });
  }, [messageIds, store]);

  return { messages, isLoadingMessages };
}

// =============================================================================
// Project Hooks
// =============================================================================

/**
 * Get all projects from the store.
 */
export function useProjects(): Array<{ id: string; path: string; name: string; starred: boolean }> {
  const projectsTable = useTable('projects') as Record<string, ProjectRow>;

  return useMemo(() => {
    return Object.entries(projectsTable).map(([id, row]) => ({
      id,
      path: row.path ?? '',
      name: row.name ?? id,
      starred: row.starred === 1,
    }));
  }, [projectsTable]);
}

/**
 * Get a single project by ID.
 */
export function useProject(projectId: string): { id: string; path: string; name: string; starred: boolean } | null {
  const row = useRow('projects', projectId) as ProjectRow;

  return useMemo(() => {
    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    return {
      id: projectId,
      path: row.path ?? '',
      name: row.name ?? projectId,
      starred: row.starred === 1,
    };
  }, [projectId, row]);
}

/**
 * Get projects for a specific workstation.
 */
export function useWorkstationProjects(
  workstationId: string | null
): Array<{ id: string; path: string; name: string; starred: boolean }> {
  const projectsTable = useTable('projects') as Record<string, ProjectRow>;

  return useMemo(() => {
    if (!workstationId) return [];

    return Object.entries(projectsTable)
      .filter(([, row]) => row.workstation_id === workstationId)
      .map(([id, row]) => ({
        id,
        path: row.path ?? '',
        name: row.name ?? id,
        starred: row.starred === 1,
      }));
  }, [projectsTable, workstationId]);
}

// =============================================================================
// Workstation Hooks
// =============================================================================

/**
 * TinyBase store row format for workstations (snake_case).
 */
interface WorkstationRow {
  name?: string;
  url?: string;
  enabled?: number;
  active?: number;
  created_at?: string;
  updated_at?: string;
}

/**
 * Workstation config returned by hooks.
 */
export interface WorkstationConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  active: boolean;
}

/**
 * Get all workstations from the store with full config.
 */
export function useWorkstations(): WorkstationConfig[] {
  const workstationsTable = useTable('workstations') as Record<string, WorkstationRow>;

  return useMemo(() => {
    return Object.entries(workstationsTable).map(([id, row]) => ({
      id,
      name: row.name ?? 'Unknown',
      url: row.url ?? '',
      enabled: row.enabled === 1,
      active: row.active === 1,
    }));
  }, [workstationsTable]);
}

/**
 * Get a single workstation by ID.
 */
export function useWorkstation(workstationId: string): WorkstationConfig | null {
  const row = useRow('workstations', workstationId) as WorkstationRow;

  return useMemo(() => {
    if (!row || Object.keys(row).length === 0) {
      return null;
    }

    return {
      id: workstationId,
      name: row.name ?? 'Unknown',
      url: row.url ?? '',
      enabled: row.enabled === 1,
      active: row.active === 1,
    };
  }, [workstationId, row]);
}

/**
 * Get the active workstation, or null if none.
 */
export function useActiveWorkstation(): WorkstationConfig | null {
  const workstations = useWorkstations();

  return useMemo(() => {
    return workstations.find((ws) => ws.active) ?? null;
  }, [workstations]);
}

// =============================================================================
// Device ID Hook
// =============================================================================

/**
 * Get the device ID from the store.
 */
export function useDeviceId(): string {
  const deviceValue = useValue('device') as string | undefined;
  return deviceValue ?? '';
}
