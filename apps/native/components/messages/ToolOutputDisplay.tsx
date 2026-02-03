import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react-native';
import { useState } from 'react';
import { View } from 'react-native';

interface ToolOutputDisplayProps {
  stdout?: string;
  stderr?: string;
  content?: string;
  maxPreviewLength?: number;
}

export function ToolOutputDisplay({
  stdout,
  stderr,
  content,
  maxPreviewLength = 200,
}: ToolOutputDisplayProps) {
  const [isOpen, setIsOpen] = useState(false);

  const output = stdout || content || '';
  const hasError = !!stderr;
  const isLong = output.length > maxPreviewLength || (stderr && stderr.length > maxPreviewLength);

  if (!output && !stderr) {
    return null;
  }

  const previewText =
    output.slice(0, maxPreviewLength) + (output.length > maxPreviewLength ? '...' : '');

  return (
    <View
      className={cn(
        'overflow-hidden rounded-sm border',
        hasError ? 'border-destructive/50 bg-destructive/10' : 'border-border bg-muted/30'
      )}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger className="flex-row items-center gap-2 px-3 py-2" disabled={!isLong}>
          <Text
            className={cn(
              'flex-1 font-mono text-xs',
              hasError ? 'text-destructive' : 'text-muted-foreground'
            )}
            numberOfLines={isOpen ? undefined : 3}>
            {isOpen ? output : previewText}
          </Text>
          {isLong && (
            <Icon
              as={isOpen ? ChevronDownIcon : ChevronRightIcon}
              className="text-muted-foreground size-4"
            />
          )}
        </CollapsibleTrigger>

        {hasError && (
          <CollapsibleContent>
            <View className="border-destructive/50 border-t px-3 py-2">
              <Text className="text-destructive mb-1 text-xs font-medium">stderr</Text>
              <Text className="text-destructive font-mono text-xs">{stderr}</Text>
            </View>
          </CollapsibleContent>
        )}
      </Collapsible>
    </View>
  );
}
