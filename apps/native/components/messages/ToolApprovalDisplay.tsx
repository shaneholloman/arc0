import { Text } from '@/components/ui/text';
import { usePendingQuestionSafe } from '@/lib/contexts/PendingQuestionContext';
import { cn } from '@/lib/utils';
import { Pressable, View } from 'react-native';

// Tool approval response types
export type ToolApprovalResponse = 'approve-once' | 'approve-always' | 'reject';

export const TOOL_APPROVAL_OPTIONS: {
  label: string;
  shortLabel: string;
  value: ToolApprovalResponse;
  variant: 'primary' | 'secondary' | 'destructive';
}[] = [
  {
    label: 'Yes',
    shortLabel: 'Yes',
    value: 'approve-once',
    variant: 'primary',
  },
  {
    label: 'Yes, always',
    shortLabel: 'Always',
    value: 'approve-always',
    variant: 'primary',
  },
  {
    label: 'No',
    shortLabel: 'No',
    value: 'reject',
    variant: 'destructive',
  },
];

interface ToolApprovalDisplayProps {
  toolName: string;
  input: Record<string, unknown>;
  answer?: string; // Tool result content if answered
  isError?: boolean;
  interactive?: boolean;
}

// Get a human-readable description for the tool
function getToolDescription(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash':
      return (input.description as string) || (input.command as string) || 'Execute command';
    case 'Read':
      return `Read ${input.file_path || 'file'}`;
    case 'Write':
      return `Write to ${input.file_path || 'file'}`;
    case 'Edit':
      return `Edit ${input.file_path || 'file'}`;
    case 'Glob':
      return `Search pattern: ${input.pattern || ''}`;
    case 'Grep':
      return `Search: ${input.pattern || ''}`;
    case 'WebFetch':
      return `Fetch ${input.url || 'URL'}`;
    case 'WebSearch':
      return `Search: ${input.query || ''}`;
    case 'Task':
      return (input.description as string) || 'Run task';
    default:
      return toolName;
  }
}

type ToolApprovalStatus = 'pending' | 'approved' | 'rejected';

function getApprovalStatus(
  answer: string | undefined,
  isError: boolean | undefined
): ToolApprovalStatus {
  if (answer === undefined) return 'pending';
  return isError ? 'rejected' : 'approved';
}

export function ToolApprovalDisplay({
  toolName,
  input,
  answer,
  isError,
  interactive,
}: ToolApprovalDisplayProps) {
  const context = usePendingQuestionSafe();

  const approvalStatus = getApprovalStatus(answer, isError);
  const isPending = approvalStatus === 'pending';

  // Get selection from context if interactive
  // We use questionIndex 0 since tool approval is always a single "question"
  const contextSelection = context?.selections.get(0) as string | undefined;
  const hasContextSelection = contextSelection !== undefined;
  const isSubmitting = context?.isSubmitting ?? false;

  // Determine the current selected value
  const selectedValue = interactive && hasContextSelection ? contextSelection : undefined;

  // Disable interactions while submitting
  const isInteractive = interactive && !isSubmitting;

  const description = getToolDescription(toolName, input);

  const handleOptionPress = (value: string) => {
    if (isInteractive && context) {
      context.selectOption(0, value);
    }
  };

  return (
    <View>
      {/* Tool info */}
      <View className="mb-3">
        <Text className="text-foreground font-mono text-sm font-medium">Allow {toolName}?</Text>
        <Text className="text-muted-foreground mt-1 font-mono text-xs" numberOfLines={2}>
          {description}
        </Text>
      </View>

      {/* Command preview for Bash */}
      {toolName === 'Bash' && typeof input.command === 'string' && (
        <View className="bg-muted mb-3 rounded-lg p-2">
          <Text className="text-foreground font-mono text-xs" numberOfLines={3}>
            {input.command}
          </Text>
        </View>
      )}

      {/* Buttons */}
      {isInteractive ? (
        <View className="flex-row gap-2">
          {TOOL_APPROVAL_OPTIONS.map((opt) => {
            const isSelected = selectedValue === opt.value;
            let bgClass: string;
            let textClass: string;

            if (opt.variant === 'primary') {
              bgClass = isSelected ? 'bg-primary' : 'bg-primary/20';
              textClass = isSelected ? 'text-primary-foreground' : 'text-primary';
            } else if (opt.variant === 'secondary') {
              bgClass = isSelected ? 'bg-muted' : 'bg-muted/50';
              textClass = isSelected ? 'text-foreground' : 'text-muted-foreground';
            } else {
              bgClass = isSelected ? 'bg-destructive' : 'bg-destructive/20';
              textClass = isSelected ? 'text-destructive-foreground' : 'text-destructive';
            }

            const viewClassName = cn(
              'flex-1 rounded-lg px-3 py-2.5',
              bgClass,
              isSubmitting && 'opacity-60'
            );
            const textClassName = cn('text-center text-xs font-medium', textClass);

            return (
              <Pressable
                key={opt.value}
                testID={`tool-${opt.value}`}
                onPress={() => handleOptionPress(opt.value)}
                disabled={isSubmitting}>
                <View className={viewClassName}>
                  <Text className={textClassName}>{opt.shortLabel}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : (
        // Non-interactive: show status
        <View className="flex-row items-center">
          {approvalStatus === 'approved' && (
            <View className="flex-row items-center gap-1.5">
              <View className="size-2 rounded-full bg-green-500" />
              <Text className="text-xs text-green-500">Allowed</Text>
            </View>
          )}
          {approvalStatus === 'rejected' && (
            <View className="flex-row items-center gap-1.5">
              <View className="bg-destructive size-2 rounded-full" />
              <Text className="text-destructive text-xs">Rejected</Text>
            </View>
          )}
        </View>
      )}

      {/* Sending indicator when submitting */}
      {isSubmitting && (
        <View className="mt-3 flex-row items-center">
          <View className="bg-primary mr-2 size-2 animate-pulse rounded-full" />
          <Text className="text-primary text-[10px] italic">Sending response...</Text>
        </View>
      )}

      {/* Awaiting indicator for non-interactive pending state */}
      {isPending && !interactive && !isSubmitting && (
        <View className="mt-3 flex-row items-center">
          <View className="bg-primary/20 mr-2 size-2 rounded-full" />
          <Text className="text-muted-foreground text-[10px] italic">Awaiting approval...</Text>
        </View>
      )}
    </View>
  );
}
