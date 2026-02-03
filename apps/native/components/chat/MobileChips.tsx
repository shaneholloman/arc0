/**
 * Display-only chips for mobile that show current mode/model.
 * Tapping either chip opens the options bottom sheet.
 */

import { Pressable, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import type { ModelId, PromptMode } from '@arc0/types';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { MODE_OPTIONS, MODEL_OPTIONS } from './InlineSelectors';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

interface MobileChipsProps {
  mode: PromptMode;
  model: ModelId;
  onPress: () => void;
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function MobileChips({ mode, model, onPress, disabled = false }: MobileChipsProps) {
  const modeLabel = MODE_OPTIONS.find((o) => o.value === mode)?.label ?? 'Auto';
  const modelLabel = MODEL_OPTIONS.find((o) => o.value === model)?.label ?? 'Default';

  return (
    <View className="flex-row items-center gap-2">
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={cn(
          'active:bg-muted flex-row items-center gap-1 rounded-md px-2 py-1',
          disabled && 'opacity-50'
        )}>
        <Text className="text-muted-foreground text-sm">{modeLabel}</Text>
        <Icon as={ChevronDown} className="text-muted-foreground size-3" />
      </Pressable>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        className={cn(
          'active:bg-muted flex-row items-center gap-1 rounded-md px-2 py-1',
          disabled && 'opacity-50'
        )}>
        <Text className="text-muted-foreground text-sm">{modelLabel}</Text>
        <Icon as={ChevronDown} className="text-muted-foreground size-3" />
      </Pressable>
    </View>
  );
}
