/**
 * Context for managing user action state (loading, error, results).
 * Wraps socket action functions with state management.
 *
 * Multi-workstation support: Actions are sent to the workstation that owns the session.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useTable } from 'tinybase/ui-react';
import type { ActionResult, ModelId, PromptMode, ProviderId, ToolResponse } from '@arc0/types';
import * as socketActions from '@/lib/socket/actions';

// =============================================================================
// Types
// =============================================================================

type ActionName = 'openSession' | 'sendPrompt' | 'stopAgent' | 'approveToolUse';

interface ActionState {
  isLoading: boolean;
  error: string | null;
  lastResult: ActionResult | null;
  sessionId: string | null; // Which session this action is for
}

interface UserActionsContextValue {
  // Action state per action
  actionStates: Record<ActionName, ActionState>;

  // Computed helpers
  isAnyActionLoading: boolean;

  // Clear error for an action
  clearError: (action: ActionName) => void;

  // Action functions (wrapped with state management)
  openSession: (provider: ProviderId, cwd: string, name?: string) => Promise<ActionResult>;
  sendPrompt: (params: {
    sessionId: string;
    text: string;
    model: ModelId;
    mode: PromptMode;
    lastMessageId?: string;
    lastMessageTs?: number;
  }) => Promise<ActionResult>;
  stopAgent: (params: {
    sessionId: string;
    lastMessageId?: string;
    lastMessageTs?: number;
  }) => Promise<ActionResult>;
  approveToolUse: (params: {
    sessionId: string;
    toolUseId: string;
    toolName: string;
    response: ToolResponse;
    lastMessageId?: string;
    lastMessageTs?: number;
  }) => Promise<ActionResult>;
}

// =============================================================================
// Context
// =============================================================================

const initialActionState: ActionState = {
  isLoading: false,
  error: null,
  lastResult: null,
  sessionId: null,
};

const initialStates: Record<ActionName, ActionState> = {
  openSession: { ...initialActionState },
  sendPrompt: { ...initialActionState },
  stopAgent: { ...initialActionState },
  approveToolUse: { ...initialActionState },
};

const UserActionsContext = createContext<UserActionsContextValue | null>(null);

// =============================================================================
// Hook
// =============================================================================

export function useUserActions() {
  const context = useContext(UserActionsContext);
  if (!context) {
    throw new Error('useUserActions must be used within UserActionsProvider');
  }
  return context;
}

// Safe version that returns null if not in provider
export function useUserActionsSafe() {
  return useContext(UserActionsContext);
}

// =============================================================================
// Provider
// =============================================================================

interface UserActionsProviderProps {
  children: ReactNode;
}

export function UserActionsProvider({ children }: UserActionsProviderProps) {
  const [actionStates, setActionStates] = useState<Record<ActionName, ActionState>>(initialStates);

  // Get workstations table to find active workstation
  const workstationsTable = useTable('workstations') as Record<string, { active?: number }>;

  // Get sessions table to find session's workstation
  const sessionsTable = useTable('sessions') as Record<string, { workstation_id?: string }>;

  // Find the active workstation ID
  const activeWorkstationId = useMemo(() => {
    for (const [id, row] of Object.entries(workstationsTable)) {
      if (row.active === 1) {
        return id;
      }
    }
    return null;
  }, [workstationsTable]);

  // Get workstation ID for a session
  const getWorkstationForSession = useCallback(
    (sessionId: string): string | null => {
      const session = sessionsTable[sessionId];
      return session?.workstation_id ?? null;
    },
    [sessionsTable]
  );

  // Helper to update action state
  const updateActionState = useCallback((action: ActionName, updates: Partial<ActionState>) => {
    setActionStates((prev) => ({
      ...prev,
      [action]: { ...prev[action], ...updates },
    }));
  }, []);

  // Clear error for an action
  const clearError = useCallback(
    (action: ActionName) => {
      updateActionState(action, { error: null });
    },
    [updateActionState]
  );

  // Wrapped action functions with workstation lookup
  const openSession = useCallback(
    async (provider: ProviderId, cwd: string, name?: string): Promise<ActionResult> => {
      // New sessions go to the active workstation
      if (!activeWorkstationId) {
        const errorResult: ActionResult = {
          status: 'error',
          code: 'NO_WORKSTATION',
          message: 'No active workstation - configure one in Settings',
        };
        updateActionState('openSession', {
          isLoading: false,
          lastResult: errorResult,
          error: errorResult.message,
        });
        return errorResult;
      }

      updateActionState('openSession', { isLoading: true, error: null, sessionId: null });
      try {
        const result = await socketActions.openSession(activeWorkstationId, provider, cwd, name);
        updateActionState('openSession', {
          isLoading: false,
          lastResult: result,
          error: result.status === 'error' ? result.message : null,
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        updateActionState('openSession', {
          isLoading: false,
          error: errorMessage,
          lastResult: { status: 'error', code: 'CLIENT_ERROR', message: errorMessage },
        });
        throw err;
      }
    },
    [activeWorkstationId, updateActionState]
  );

  const sendPrompt = useCallback(
    async (params: {
      sessionId: string;
      text: string;
      model: ModelId;
      mode: PromptMode;
      lastMessageId?: string;
      lastMessageTs?: number;
    }): Promise<ActionResult> => {
      const workstationId = getWorkstationForSession(params.sessionId);
      if (!workstationId) {
        const errorResult: ActionResult = {
          status: 'error',
          code: 'NO_WORKSTATION',
          message: 'Session workstation not found',
        };
        updateActionState('sendPrompt', {
          isLoading: false,
          lastResult: errorResult,
          error: errorResult.message,
          sessionId: null,
        });
        return errorResult;
      }

      updateActionState('sendPrompt', {
        isLoading: true,
        error: null,
        sessionId: params.sessionId,
      });
      try {
        const result = await socketActions.sendPrompt(workstationId, params);
        updateActionState('sendPrompt', {
          isLoading: false,
          lastResult: result,
          error: result.status === 'error' ? result.message : null,
          sessionId: null,
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        updateActionState('sendPrompt', {
          isLoading: false,
          error: errorMessage,
          lastResult: { status: 'error', code: 'CLIENT_ERROR', message: errorMessage },
          sessionId: null,
        });
        throw err;
      }
    },
    [getWorkstationForSession, updateActionState]
  );

  const stopAgent = useCallback(
    async (params: {
      sessionId: string;
      lastMessageId?: string;
      lastMessageTs?: number;
    }): Promise<ActionResult> => {
      const workstationId = getWorkstationForSession(params.sessionId);
      if (!workstationId) {
        const errorResult: ActionResult = {
          status: 'error',
          code: 'NO_WORKSTATION',
          message: 'Session workstation not found',
        };
        updateActionState('stopAgent', {
          isLoading: false,
          lastResult: errorResult,
          error: errorResult.message,
          sessionId: null,
        });
        return errorResult;
      }

      updateActionState('stopAgent', { isLoading: true, error: null, sessionId: params.sessionId });
      try {
        const result = await socketActions.stopAgent(workstationId, params);
        updateActionState('stopAgent', {
          isLoading: false,
          lastResult: result,
          error: result.status === 'error' ? result.message : null,
          sessionId: null,
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        updateActionState('stopAgent', {
          isLoading: false,
          error: errorMessage,
          lastResult: { status: 'error', code: 'CLIENT_ERROR', message: errorMessage },
          sessionId: null,
        });
        throw err;
      }
    },
    [getWorkstationForSession, updateActionState]
  );

  const approveToolUse = useCallback(
    async (params: {
      sessionId: string;
      toolUseId: string;
      toolName: string;
      response: ToolResponse;
      lastMessageId?: string;
      lastMessageTs?: number;
    }): Promise<ActionResult> => {
      const workstationId = getWorkstationForSession(params.sessionId);
      if (!workstationId) {
        const errorResult: ActionResult = {
          status: 'error',
          code: 'NO_WORKSTATION',
          message: 'Session workstation not found',
        };
        updateActionState('approveToolUse', {
          isLoading: false,
          lastResult: errorResult,
          error: errorResult.message,
          sessionId: null,
        });
        return errorResult;
      }

      updateActionState('approveToolUse', {
        isLoading: true,
        error: null,
        sessionId: params.sessionId,
      });
      try {
        const result = await socketActions.approveToolUse(workstationId, params);
        updateActionState('approveToolUse', {
          isLoading: false,
          lastResult: result,
          error: result.status === 'error' ? result.message : null,
          sessionId: null,
        });
        return result;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        updateActionState('approveToolUse', {
          isLoading: false,
          error: errorMessage,
          lastResult: { status: 'error', code: 'CLIENT_ERROR', message: errorMessage },
          sessionId: null,
        });
        throw err;
      }
    },
    [getWorkstationForSession, updateActionState]
  );

  // Computed: is any action loading
  const isAnyActionLoading = useMemo(
    () => Object.values(actionStates).some((state) => state.isLoading),
    [actionStates]
  );

  const value = useMemo(
    () => ({
      actionStates,
      isAnyActionLoading,
      clearError,
      openSession,
      sendPrompt,
      stopAgent,
      approveToolUse,
    }),
    [
      actionStates,
      isAnyActionLoading,
      clearError,
      openSession,
      sendPrompt,
      stopAgent,
      approveToolUse,
    ]
  );

  return <UserActionsContext.Provider value={value}>{children}</UserActionsContext.Provider>;
}
