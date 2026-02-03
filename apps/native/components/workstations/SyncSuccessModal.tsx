/**
 * SyncSuccessModal: Shows sync progress and success feedback after pairing a workstation.
 *
 * States:
 * - syncing: Shows spinner + shimmering "Syncing open sessions..." (non-dismissible)
 * - complete: Shows green checkmark + "Ready!" + appropriate action button (dismissible)
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, View } from 'react-native';
import { CheckCircleIcon, XIcon } from 'lucide-react-native';
import { useUniwind } from 'uniwind';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Shimmer } from '@/components/ui/shimmer';
import { THEME } from '@/lib/theme';

// =============================================================================
// Types
// =============================================================================

interface SyncSuccessModalProps {
  visible: boolean;
  /** Whether there are sessions to view (reactive - updates as sessions sync) */
  hasSessions: boolean;
  onViewSessions: () => void;
  onCreateSession: () => void;
  /** Called when modal is dismissed without taking action */
  onClose?: () => void;
}

type SyncState = 'syncing' | 'complete';

// =============================================================================
// Component
// =============================================================================

export function SyncSuccessModal({
  visible,
  hasSessions,
  onViewSessions,
  onCreateSession,
  onClose,
}: SyncSuccessModalProps) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];

  const [state, setState] = useState<SyncState>('syncing');

  // Auto-transition from syncing to complete after 3 seconds
  useEffect(() => {
    if (visible) {
      setState('syncing');
      const timer = setTimeout(() => {
        setState('complete');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  const handleAction = () => {
    if (hasSessions) {
      onViewSessions();
    } else {
      onCreateSession();
    }
  };

  // Only allow dismissing in complete state
  const handleRequestClose = () => {
    if (state === 'complete') {
      onClose?.();
    }
  };

  const handleBackdropPress = () => {
    if (state === 'complete') {
      onClose?.();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleRequestClose}>
      <Pressable
        className="flex-1 items-center justify-center bg-black/50 p-4"
        onPress={handleBackdropPress}>
        <Pressable
          onPress={(e) => e.stopPropagation()}
          className="bg-card border-border w-full max-w-sm items-center rounded-xl border p-6">
          {state === 'syncing' ? (
            <>
              <ActivityIndicator size="large" color={colors.primary} />
              <Shimmer isShimmering>
                <Text className="text-foreground mt-4 text-lg font-medium">
                  Syncing open sessions...
                </Text>
              </Shimmer>
            </>
          ) : (
            <>
              {/* Close button */}
              {onClose && (
                <Pressable
                  onPress={onClose}
                  hitSlop={8}
                  accessibilityLabel="Close"
                  accessibilityRole="button"
                  className="absolute top-4 right-4 active:opacity-70">
                  <Icon as={XIcon} className="text-muted-foreground size-5" />
                </Pressable>
              )}

              <View className="mb-2 h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
                <Icon as={CheckCircleIcon} className="text-green-500" size={40} />
              </View>
              <Text className="text-foreground text-xl font-semibold">Ready!</Text>
              <Text className="text-muted-foreground mt-2 text-center">
                Sessions from your workstation will now sync automatically.
              </Text>
              <Pressable
                testID="sync-success-action-button"
                onPress={handleAction}
                accessibilityLabel={hasSessions ? 'View sessions' : 'Create a new session'}
                accessibilityRole="button"
                className="bg-primary mt-6 w-full items-center rounded-lg py-3 active:opacity-70">
                <Text className="text-primary-foreground font-medium">
                  {hasSessions ? 'View Sessions' : 'Create Session'}
                </Text>
              </Pressable>
            </>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
