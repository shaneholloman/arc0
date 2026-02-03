import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface ScrollToMessageContextValue {
  // The target message UUID to scroll to
  targetMessageUuid: string | null;

  // Actions
  requestScrollToMessage: (uuid: string) => void;
  clearScrollRequest: () => void;
}

const ScrollToMessageContext = createContext<ScrollToMessageContextValue | null>(null);

export function useScrollToMessage() {
  const context = useContext(ScrollToMessageContext);
  if (!context) {
    throw new Error('useScrollToMessage must be used within ScrollToMessageProvider');
  }
  return context;
}

// Safe version that returns null if not in provider (for optional usage)
export function useScrollToMessageSafe() {
  return useContext(ScrollToMessageContext);
}

interface ScrollToMessageProviderProps {
  children: ReactNode;
}

export function ScrollToMessageProvider({ children }: ScrollToMessageProviderProps) {
  const [targetMessageUuid, setTargetMessageUuid] = useState<string | null>(null);

  const requestScrollToMessage = useCallback((uuid: string) => {
    setTargetMessageUuid(uuid);
  }, []);

  const clearScrollRequest = useCallback(() => {
    setTargetMessageUuid(null);
  }, []);

  const value = useMemo(
    () => ({
      targetMessageUuid,
      requestScrollToMessage,
      clearScrollRequest,
    }),
    [targetMessageUuid, requestScrollToMessage, clearScrollRequest]
  );

  return (
    <ScrollToMessageContext.Provider value={value}>{children}</ScrollToMessageContext.Provider>
  );
}
