/**
 * Stop button for interrupting the agent.
 * Shows loading state with ActivityIndicator when stopping.
 */

import { ActivityIndicator, Pressable } from 'react-native';
import { SquareIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';

// =============================================================================
// Types
// =============================================================================

interface StopButtonProps {
  onPress: () => void;
  isLoading?: boolean;
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function StopButton({ onPress, isLoading = false, disabled = false }: StopButtonProps) {
  return (
    <Pressable
      testID="stop-button"
      onPress={onPress}
      disabled={disabled || isLoading}
      className="bg-destructive rounded-full p-2 active:opacity-80 disabled:opacity-50"
      accessibilityRole="button"
      accessibilityLabel="Stop agent"
      accessibilityHint="Interrupts the currently running agent">
      {isLoading ? (
        <ActivityIndicator size="small" color="white" />
      ) : (
        <Icon as={SquareIcon} className="text-destructive-foreground size-4" />
      )}
    </Pressable>
  );
}
