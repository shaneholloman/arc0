/**
 * Bottom sheet for mobile to select mode and model.
 * Opens when user taps the mode/model chips in the composer.
 */

import { useEffect } from 'react';
import { Keyboard, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Portal } from '@rn-primitives/portal';
import { XIcon } from 'lucide-react-native';
import type { ModelId, PromptMode } from '@arc0/types';

import { Icon } from '@/components/ui/icon';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Text } from '@/components/ui/text';
import { MODE_OPTIONS, MODEL_OPTIONS } from './InlineSelectors';

// =============================================================================
// Types
// =============================================================================

interface ComposerOptionsSheetProps {
  open: boolean;
  onClose: () => void;
  mode: PromptMode;
  model: ModelId;
  onModeChange: (mode: PromptMode) => void;
  onModelChange: (model: ModelId) => void;
}

// =============================================================================
// Component
// =============================================================================

export function ComposerOptionsSheet({
  open,
  onClose,
  mode,
  model,
  onModeChange,
  onModelChange,
}: ComposerOptionsSheetProps) {
  const insets = useSafeAreaInsets();

  // Dismiss keyboard when sheet opens
  useEffect(() => {
    if (open) {
      Keyboard.dismiss();
    }
  }, [open]);

  if (!open) return null;

  return (
    <Portal name="composer-options">
      {/* Backdrop */}
      <Pressable
        className="absolute inset-0 bg-black/50"
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close options"
      />

      {/* Sheet content */}
      <View
        className="bg-background border-border absolute inset-x-0 bottom-0 rounded-t-2xl border-t"
        style={{ paddingBottom: Math.max(insets.bottom, 16) }}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-4 py-4">
          <Text className="text-lg font-semibold">Options</Text>
          <Pressable
            onPress={onClose}
            className="active:bg-accent rounded-lg p-2"
            accessibilityRole="button"
            accessibilityLabel="Close">
            <Icon as={XIcon} className="text-muted-foreground size-5" />
          </Pressable>
        </View>

        {/* Mode selection */}
        <View className="gap-3 px-4 pb-4">
          <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Mode
          </Text>
          <RadioGroup value={mode} onValueChange={(val) => val && onModeChange(val as PromptMode)}>
            {MODE_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => onModeChange(option.value)}
                className="flex-row items-center gap-3 py-2">
                <RadioGroupItem value={option.value} />
                <Text className="text-foreground">{option.label}</Text>
              </Pressable>
            ))}
          </RadioGroup>
        </View>

        {/* Model selection */}
        <View className="gap-3 px-4 pb-4">
          <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
            Model
          </Text>
          <RadioGroup value={model} onValueChange={(val) => val && onModelChange(val as ModelId)}>
            {MODEL_OPTIONS.map((option) => (
              <Pressable
                key={option.value}
                onPress={() => onModelChange(option.value)}
                className="flex-row items-center gap-3 py-2">
                <RadioGroupItem value={option.value} />
                <Text className="text-foreground">{option.label}</Text>
              </Pressable>
            ))}
          </RadioGroup>
        </View>
      </View>
    </Portal>
  );
}
