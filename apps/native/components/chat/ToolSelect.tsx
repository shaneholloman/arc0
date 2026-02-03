/**
 * Tool select component for inline mode/model pickers.
 * Minimal styling - just text with a chevron, no background/border.
 * Uses tailwind classes to reference global CSS design tokens.
 */

import * as SelectPrimitive from '@rn-primitives/select';
import { Check, ChevronDown } from 'lucide-react-native';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/utils';

// =============================================================================
// Types
// =============================================================================

export interface Option {
  value: string;
  label: string;
}

interface ToolSelectProps {
  value: string;
  options: Option[];
  onValueChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

// =============================================================================
// Component
// =============================================================================

export function ToolSelect({
  value,
  options,
  onValueChange,
  placeholder = 'Select',
  disabled = false,
}: ToolSelectProps) {
  const selectedOption = options.find((opt) => opt.value === value);
  const displayLabel = selectedOption?.label ?? placeholder;

  return (
    <SelectPrimitive.Root
      value={
        selectedOption ? { value: selectedOption.value, label: selectedOption.label } : undefined
      }
      onValueChange={(option) => {
        if (option && !disabled) {
          onValueChange(option.value);
        }
      }}>
      <SelectPrimitive.Trigger disabled={disabled} asChild>
        <Pressable
          className={cn(
            'hover:bg-muted flex-row items-center gap-1 rounded-md px-2 py-1',
            disabled && 'opacity-50'
          )}
          accessibilityRole="button">
          <Text className="text-muted-foreground text-sm">{displayLabel}</Text>
          <Icon as={ChevronDown} className="text-muted-foreground size-3" />
        </Pressable>
      </SelectPrimitive.Trigger>

      <SelectPrimitive.Portal>
        <SelectPrimitive.Overlay
          style={Platform.OS !== 'web' ? StyleSheet.absoluteFill : undefined}>
          <SelectPrimitive.Content
            className="bg-popover border-border z-50 min-w-[100px] rounded-lg border p-1 shadow-md"
            side="top"
            sideOffset={8}>
            <SelectPrimitive.Viewport>
              {options.map((option) => (
                <SelectPrimitive.Item
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  className="hover:bg-muted active:bg-accent relative flex w-full flex-row items-center rounded-md py-2 pr-8 pl-2">
                  <SelectPrimitive.ItemText className="text-foreground text-sm" />
                  <View className="absolute right-2">
                    <SelectPrimitive.ItemIndicator>
                      <Icon as={Check} className="text-foreground size-4" />
                    </SelectPrimitive.ItemIndicator>
                  </View>
                </SelectPrimitive.Item>
              ))}
            </SelectPrimitive.Viewport>
          </SelectPrimitive.Content>
        </SelectPrimitive.Overlay>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
