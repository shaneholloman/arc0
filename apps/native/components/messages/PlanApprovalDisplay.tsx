import { MarkdownContent } from '@/components/artifacts';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Text } from '@/components/ui/text';
import { usePendingQuestionSafe } from '@/lib/contexts/PendingQuestionContext';
import { cn } from '@/lib/utils';
import { FileTextIcon } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { Icon } from '@/components/ui/icon';

// Plan approval response types (matching Claude CLI options)
export type PlanApprovalResponse = 'clear-bypass' | 'bypass' | 'manual' | 'feedback';

export const PLAN_APPROVAL_OPTIONS: {
  label: string;
  value: PlanApprovalResponse;
  description?: string;
}[] = [
  {
    label: 'Yes, clear context and bypass',
    value: 'clear-bypass',
    description: 'Clear conversation context, auto-approve file edits',
  },
  {
    label: 'Yes, and bypass permissions',
    value: 'bypass',
    description: 'Keep context, auto-approve file edits',
  },
  {
    label: 'Yes, manually approve edits',
    value: 'manual',
    description: 'Review each file change before applying',
  },
  {
    label: 'Provide feedback',
    value: 'feedback',
    description: 'Tell Claude what to change in the plan',
  },
];

interface PlanApprovalDisplayProps {
  planFilePath?: string;
  planContent?: string; // The actual plan content from input.plan
  answer?: string; // Tool result content if answered
  interactive?: boolean;
}

// Parse the approval response from tool_result
function parseApprovalResponse(answer: string | undefined): PlanApprovalResponse | null {
  if (!answer) return null;

  if (answer.includes('User has approved your plan')) {
    // Check more specific patterns first to avoid false matches
    if (answer.includes('clear context') && answer.includes('bypass')) {
      return 'clear-bypass';
    }
    if (answer.includes('bypass')) {
      return 'bypass';
    }
    if (answer.includes('manual')) {
      return 'manual';
    }
    return 'bypass';
  }

  // Check for feedback (rejection with custom text)
  if (answer.includes("user doesn't want to proceed") || answer.includes('user said:')) {
    return 'feedback';
  }

  return null;
}

// Extract feedback text from rejection response
function extractFeedback(answer: string | undefined): string | null {
  if (!answer) return null;

  const match = answer.match(/the user said:\s*(.+)$/is);
  if (match) {
    return match[1].trim();
  }

  return null;
}

export function PlanApprovalDisplay({
  planFilePath,
  planContent,
  answer,
  interactive,
}: PlanApprovalDisplayProps) {
  const context = usePendingQuestionSafe();

  const existingResponse = parseApprovalResponse(answer);
  const existingFeedback = extractFeedback(answer);
  const isPending = !answer;

  // Get selection from context if interactive
  // We use questionIndex 0 since plan approval is always a single "question"
  const contextSelection = context?.selections.get(0) as string | undefined;
  const hasContextSelection = contextSelection !== undefined;
  const isSubmitting = context?.isSubmitting ?? false;

  // Determine the current selected value
  const selectedValue = interactive && hasContextSelection ? contextSelection : existingResponse;

  // Disable interactions while submitting
  const isInteractive = interactive && !isSubmitting;

  const handleOptionPress = (value: string) => {
    if (isInteractive && context) {
      context.selectOption(0, value);
    }
  };

  return (
    <View>
      {/* Plan content display */}
      {planContent ? (
        <View className="mb-4">
          <Text className="mb-2 text-xs font-medium text-muted-foreground">Plan</Text>
          <View className="rounded-lg border border-border bg-background p-3">
            <MarkdownContent content={planContent} />
          </View>
        </View>
      ) : null}

      {/* Header */}
      <Text className="text-foreground mb-3 text-sm font-medium">Would you like to proceed?</Text>

      {/* Options */}
      <RadioGroup value={selectedValue ?? ''} onValueChange={() => {}} disabled={!isInteractive}>
        <View className="gap-2">
          {PLAN_APPROVAL_OPTIONS.map((opt) => {
            const isSelected = selectedValue === opt.value;
            const shouldDim = isInteractive
              ? hasContextSelection && !isSelected
              : existingResponse && !isSelected;

            const content = (
              <View
                className={cn(
                  'flex-row items-center rounded-lg border px-3 py-2.5',
                  isSelected ? 'border-primary bg-primary/10' : 'border-border',
                  shouldDim ? 'opacity-50' : 'opacity-100',
                  isSubmitting ? 'opacity-60' : ''
                )}>
                <RadioGroupItem value={opt.value} />
                <View className="ml-2 flex-1">
                  <Text
                    className={cn(
                      'text-xs font-medium',
                      isSelected ? 'text-primary' : 'text-foreground'
                    )}>
                    {opt.label}
                  </Text>
                  {opt.description && (
                    <Text className="text-muted-foreground mt-0.5 text-[10px]">{opt.description}</Text>
                  )}
                </View>
              </View>
            );

            if (isInteractive) {
              return (
                <Pressable key={opt.value} testID={`plan-${opt.value}`} onPress={() => handleOptionPress(opt.value)}>
                  {content}
                </Pressable>
              );
            }

            return <View key={opt.value} testID={`plan-${opt.value}`}>{content}</View>;
          })}
        </View>
      </RadioGroup>

      {/* Show feedback text if it was a rejection with feedback */}
      {existingFeedback ? (
        <View className="border-primary/30 bg-primary/5 mt-3 rounded-lg border p-3">
          <Text className="text-muted-foreground mb-1 text-[10px] font-medium">Your feedback:</Text>
          <Text className="text-foreground text-xs">{existingFeedback}</Text>
        </View>
      ) : null}

      {/* Plan file path hint */}
      {planFilePath ? (
        <View className="mt-3 flex-row items-center gap-1.5">
          <Icon as={FileTextIcon} className="text-muted-foreground size-3" />
          <Text className="text-muted-foreground text-[10px]">{planFilePath}</Text>
        </View>
      ) : null}

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

// Helper to format the response for submission
export function formatPlanApprovalResponse(
  selection: PlanApprovalResponse,
  feedbackText?: string,
  planContent?: string
): string {
  switch (selection) {
    case 'clear-bypass':
      return `User has approved your plan with clear context and bypass permissions. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ~/.claude/plans/current-plan.md
You can refer back to it if needed during implementation.

## Approved Plan:
${planContent || '[Plan content]'}`;

    case 'manual':
      return `User has approved your plan with manual approval mode. You can now start coding, but each file edit will require explicit approval. Start with updating your todo list if applicable

Your plan has been saved to: ~/.claude/plans/current-plan.md
You can refer back to it if needed during implementation.

## Approved Plan:
${planContent || '[Plan content]'}`;

    case 'bypass':
      return `User has approved your plan with keep context and bypass permissions. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ~/.claude/plans/current-plan.md
You can refer back to it if needed during implementation.

## Approved Plan:
${planContent || '[Plan content]'}`;

    case 'feedback':
      return `The user doesn't want to proceed with this tool use. The tool use was rejected. To tell you how to proceed, the user said:
${feedbackText || 'Please revise the plan.'}`;

    default:
      return '';
  }
}
