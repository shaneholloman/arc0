import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Text } from '@/components/ui/text';
import { OTHER_OPTION, usePendingQuestionSafe } from '@/lib/contexts/PendingQuestionContext';
import { cn } from '@/lib/utils';
import { Pressable, View } from 'react-native';

interface QuestionOption {
  label: string;
  description: string;
}

interface Question {
  question: string;
  header: string;
  options: QuestionOption[];
  multiSelect: boolean;
}

interface AskUserQuestionDisplayProps {
  questions: Question[];
  answer?: string; // Raw tool_result content
  interactive?: boolean; // Enable selection mode
  toolUseId?: string; // For tracking which question this is
}

// Parse answers from the output string format:
// "User has answered your questions: "Question1"="Answer1", "Question2"="Answer2"..."
// For multi-select, answers are comma-separated: "Option A, Option B, Option C"
function parseAnswers(output: string | undefined): Map<string, string> {
  const answers = new Map<string, string>();
  if (!output) return answers;

  // Match patterns like "Question"="Answer"
  const regex = /"([^"]+)"="([^"]+)"/g;
  let match;
  while ((match = regex.exec(output)) !== null) {
    answers.set(match[1], match[2]);
  }
  return answers;
}

// Parse multi-select answer into array of selected options
function parseMultiSelectAnswer(answer: string | undefined): string[] {
  if (!answer) return [];
  // Split by comma and trim whitespace
  return answer.split(',').map((s) => s.trim());
}

// Check if an option is selected (works for both single and multi-select)
function isOptionSelected(
  optionLabel: string,
  answeredValue: string | undefined,
  isMultiSelect: boolean
): boolean {
  if (!answeredValue) return false;

  if (isMultiSelect) {
    const selectedOptions = parseMultiSelectAnswer(answeredValue);
    return selectedOptions.some((selected) => selected === optionLabel);
  }

  return answeredValue === optionLabel;
}

// Check if the answer is a custom "Other" response (not matching any predefined options)
function isCustomAnswer(
  answeredValue: string | undefined,
  options: QuestionOption[],
  isMultiSelect: boolean
): boolean {
  if (!answeredValue) return false;

  if (isMultiSelect) {
    const selectedOptions = parseMultiSelectAnswer(answeredValue);
    // Check if any selected option is not in the predefined options
    return selectedOptions.some((selected) => !options.some((opt) => opt.label === selected));
  }

  return !options.some((opt) => opt.label === answeredValue);
}

// Get the custom part of the answer (options not in predefined list)
function getCustomAnswerText(
  answeredValue: string | undefined,
  options: QuestionOption[],
  isMultiSelect: boolean
): string {
  if (!answeredValue) return '';

  if (isMultiSelect) {
    const selectedOptions = parseMultiSelectAnswer(answeredValue);
    const customOptions = selectedOptions.filter(
      (selected) => !options.some((opt) => opt.label === selected)
    );
    return customOptions.join(', ');
  }

  return answeredValue;
}

// Check if option is selected from context selections
function isContextSelected(
  optionLabel: string,
  selections: Map<number, string | string[]>,
  questionIndex: number,
  isMultiSelect: boolean
): boolean {
  const selection = selections.get(questionIndex);
  if (!selection) return false;

  if (isMultiSelect && Array.isArray(selection)) {
    return selection.includes(optionLabel);
  }

  return selection === optionLabel;
}

function SingleSelectQuestion({
  question,
  questionIndex,
  answeredValue,
  interactive,
}: {
  question: Question;
  questionIndex: number;
  answeredValue?: string;
  interactive?: boolean;
}) {
  const context = usePendingQuestionSafe();
  const hasCustomAnswer = isCustomAnswer(answeredValue, question.options, false);
  const existingCustomText = hasCustomAnswer ? answeredValue : '';

  // Get selection from context if interactive
  const contextSelection = context?.selections.get(questionIndex);
  const hasContextSelection = contextSelection !== undefined;
  const isOtherSelected = contextSelection === OTHER_OPTION;
  const isSubmitting = context?.isSubmitting ?? false;

  // Disable interactions while submitting
  const isInteractive = interactive && !isSubmitting;

  return (
    <RadioGroup
      value={isInteractive && hasContextSelection ? (contextSelection as string) : answeredValue}
      onValueChange={() => {}}
      disabled={!isInteractive}>
      <View className="gap-1.5">
        {question.options.map((opt, optIndex) => {
          // Determine if selected: use context selection in interactive mode, otherwise use answeredValue
          const isSelected = isInteractive
            ? isContextSelected(opt.label, context?.selections ?? new Map(), questionIndex, false)
            : answeredValue === opt.label;

          // Determine if should be dimmed
          const shouldDim = isInteractive
            ? hasContextSelection && !isSelected
            : answeredValue && !isSelected;

          const handlePress = () => {
            if (isInteractive && context) {
              context.selectOption(questionIndex, opt.label);
            }
          };

          const content = (
            <View
              className={cn(
                'flex-row items-center rounded-lg border px-3 py-2',
                isSelected ? 'border-primary bg-primary/10' : 'border-border',
                shouldDim ? 'opacity-50' : 'opacity-100',
                isSubmitting ? 'opacity-60' : ''
              )}>
              <RadioGroupItem value={opt.label} />
              <View className="ml-2 flex-1">
                <Text
                  className={cn(
                    'text-xs font-medium',
                    isSelected ? 'text-primary' : 'text-foreground'
                  )}>
                  {opt.label}
                </Text>
                {opt.description && (
                  <Text className="text-muted-foreground mt-0.5 text-[10px]">
                    {opt.description}
                  </Text>
                )}
              </View>
            </View>
          );

          if (isInteractive) {
            return (
              <Pressable key={optIndex} onPress={handlePress}>
                {content}
              </Pressable>
            );
          }

          return <View key={optIndex}>{content}</View>;
        })}

        {/* Interactive "Other" option */}
        {isInteractive && (
          <Pressable
            onPress={() => {
              if (context) {
                context.selectOption(questionIndex, OTHER_OPTION);
              }
            }}>
            <View
              className={cn(
                'flex-row items-center rounded-lg border px-3 py-2',
                isOtherSelected ? 'border-primary bg-primary/10' : 'border-border',
                hasContextSelection && !isOtherSelected ? 'opacity-50' : 'opacity-100'
              )}>
              <RadioGroupItem value={OTHER_OPTION} />
              <View className="ml-2 flex-1">
                <Text
                  className={cn(
                    'text-xs font-medium',
                    isOtherSelected ? 'text-primary' : 'text-foreground'
                  )}>
                  Other
                </Text>
                <Text className="text-muted-foreground mt-0.5 text-[10px]">
                  Type in the input box below
                </Text>
              </View>
            </View>
          </Pressable>
        )}

        {/* Custom "Other" response (only shown for answered non-interactive questions) */}
        {!interactive && hasCustomAnswer && existingCustomText && (
          <View className="border-primary bg-primary/10 flex-row items-center rounded-lg border px-3 py-2">
            <RadioGroupItem value={existingCustomText} />
            <View className="ml-2 flex-1">
              <Text className="text-primary text-xs font-medium">
                Other: &quot;{existingCustomText}&quot;
              </Text>
            </View>
          </View>
        )}
      </View>
    </RadioGroup>
  );
}

function MultiSelectQuestion({
  question,
  questionIndex,
  answeredValue,
  interactive,
}: {
  question: Question;
  questionIndex: number;
  answeredValue?: string;
  interactive?: boolean;
}) {
  const context = usePendingQuestionSafe();
  const hasCustomAnswer = isCustomAnswer(answeredValue, question.options, true);
  const customText = hasCustomAnswer
    ? getCustomAnswerText(answeredValue, question.options, true)
    : '';
  const isSubmitting = context?.isSubmitting ?? false;

  // Disable interactions while submitting
  const isInteractive = interactive && !isSubmitting;

  // Get selection from context if interactive
  const contextSelection = context?.selections.get(questionIndex);
  const hasContextSelection = contextSelection !== undefined;

  return (
    <View className="gap-1.5">
      {question.options.map((opt, optIndex) => {
        // Determine if selected: use context selection in interactive mode, otherwise use answeredValue
        const isSelected = isInteractive
          ? isContextSelected(opt.label, context?.selections ?? new Map(), questionIndex, true)
          : isOptionSelected(opt.label, answeredValue, true);

        // Determine if should be dimmed
        const shouldDim = isInteractive
          ? hasContextSelection && !isSelected
          : answeredValue && !isSelected;

        const handlePress = () => {
          if (isInteractive && context) {
            context.toggleOption(questionIndex, opt.label);
          }
        };

        const content = (
          <View
            className={cn(
              'flex-row items-center rounded-lg border px-3 py-2',
              isSelected ? 'border-primary bg-primary/10' : 'border-border',
              shouldDim ? 'opacity-50' : 'opacity-100',
              isSubmitting ? 'opacity-60' : ''
            )}>
            <Checkbox checked={isSelected} onCheckedChange={() => {}} disabled={!isInteractive} />
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
            <Pressable key={optIndex} onPress={handlePress}>
              {content}
            </Pressable>
          );
        }

        return <View key={optIndex}>{content}</View>;
      })}

      {/* Custom "Other" response (only shown for answered questions) */}
      {hasCustomAnswer && customText && (
        <View className="border-primary bg-primary/10 flex-row items-center rounded-lg border px-3 py-2">
          <Checkbox checked onCheckedChange={() => {}} disabled />
          <View className="ml-2 flex-1">
            <Text className="text-primary text-xs font-medium">
              Other: &quot;{customText}&quot;
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

function QuestionSection({
  question,
  questionIndex,
  answeredValue,
  interactive,
}: {
  question: Question;
  questionIndex: number;
  answeredValue?: string;
  interactive?: boolean;
}) {
  return (
    <View className="mb-3">
      {/* Header chip */}
      <View className="mb-1 flex-row items-center gap-1.5">
        <View className="bg-muted/50 rounded px-2 py-0.5">
          <Text className="text-muted-foreground text-[10px] font-medium">{question.header}</Text>
        </View>
      </View>

      {/* Question text */}
      <Text className="text-foreground mb-2 text-xs">{question.question}</Text>

      {/* Options */}
      {question.multiSelect ? (
        <MultiSelectQuestion
          question={question}
          questionIndex={questionIndex}
          answeredValue={answeredValue}
          interactive={interactive}
        />
      ) : (
        <SingleSelectQuestion
          question={question}
          questionIndex={questionIndex}
          answeredValue={answeredValue}
          interactive={interactive}
        />
      )}
    </View>
  );
}

export function AskUserQuestionDisplay({
  questions,
  answer,
  interactive,
}: AskUserQuestionDisplayProps) {
  const context = usePendingQuestionSafe();
  const isSubmitting = context?.isSubmitting ?? false;

  if (!questions || questions.length === 0) {
    return null;
  }

  const existingAnswers = parseAnswers(answer);
  const isPending = !answer;

  return (
    <View>
      {questions.map((q, qIndex) => {
        const answeredValue = existingAnswers.get(q.question);
        return (
          <QuestionSection
            key={qIndex}
            question={q}
            questionIndex={qIndex}
            answeredValue={answeredValue}
            interactive={interactive && isPending}
          />
        );
      })}
      {/* Sending indicator when submitting */}
      {isSubmitting && (
        <View className="mt-2 flex-row items-center">
          <View className="bg-primary mr-2 size-2 animate-pulse rounded-full" />
          <Text className="text-primary text-[10px] italic">Sending response...</Text>
        </View>
      )}
      {/* Only show awaiting indicator if pending and NOT interactive and NOT submitting */}
      {isPending && !interactive && !isSubmitting && (
        <View className="mt-2 flex-row items-center">
          <View className="bg-primary/20 mr-2 size-2 rounded-full" />
          <Text className="text-muted-foreground text-[10px] italic">Awaiting response...</Text>
        </View>
      )}
    </View>
  );
}
