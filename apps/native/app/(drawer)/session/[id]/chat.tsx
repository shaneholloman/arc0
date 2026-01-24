import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MessageList } from '@/components/messages';
import { ModeModelBar, StopButton } from '@/components/chat';
import {
  PLAN_APPROVAL_OPTIONS,
  type PlanApprovalResponse,
} from '@/components/messages/PlanApprovalDisplay';
import { type ToolApprovalResponse } from '@/components/messages/ToolApprovalDisplay';
import {
  OTHER_OPTION,
  PendingQuestionProvider,
  usePendingQuestion,
} from '@/lib/contexts/PendingQuestionContext';
import { useUserActions } from '@/lib/contexts/UserActionsContext';
import { useMessages } from '@/lib/store/hooks';
import { useStoreContext } from '@/lib/store/provider';
import { THEME } from '@/lib/theme';
import type { Message } from '@/lib/types/session';
import { findLatestPendingTool, isNonInteractiveTool } from '@/lib/utils/tool-state';
import type { ModelId, PromptMode, AnswerItem, ToolResponse } from '@arc0/types';
import { useLocalSearchParams } from 'expo-router';
import { MessageSquareIcon, SendIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Platform, Pressable, TextInput, View } from 'react-native';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useUniwind } from 'uniwind';

interface Question {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

type PendingInteractiveTool =
  | { type: 'AskUserQuestion'; questions: Question[]; toolUseId: string }
  | { type: 'ExitPlanMode'; planFilePath?: string; toolUseId: string }
  | { type: 'ToolPermission'; toolName: string; toolUseId: string; input: Record<string, unknown> };

// Find the latest pending interactive tool from messages
function findPendingInteractiveTool(messages: Message[]): PendingInteractiveTool | null {
  if (messages.length === 0) return null;

  const pendingTool = findLatestPendingTool(messages);
  if (!pendingTool) return null;

  const toolUse = pendingTool.block;
  if (toolUse.name === 'AskUserQuestion' && toolUse.input?.questions) {
    return {
      type: 'AskUserQuestion',
      questions: toolUse.input.questions as Question[],
      toolUseId: toolUse.id,
    };
  }

  if (toolUse.name === 'ExitPlanMode') {
    return {
      type: 'ExitPlanMode',
      planFilePath: toolUse.input?.planFilePath as string | undefined,
      toolUseId: toolUse.id,
    };
  }

  if (isNonInteractiveTool(toolUse.name)) {
    return null;
  }

  return {
    type: 'ToolPermission',
    toolName: toolUse.name,
    toolUseId: toolUse.id,
    input: (toolUse.input ?? {}) as Record<string, unknown>,
  };
}

// Check if agent is currently running (last assistant message has tool_use stopReason)
function isAgentRunning(messages: Message[]): boolean {
  if (messages.length === 0) return false;

  // Find the last assistant message
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'assistant') {
      if (msg.stopReason !== 'tool_use') {
        return false;
      }
      const pendingTool = findLatestPendingTool(messages);
      if (!pendingTool) {
        return true;
      }
      return isNonInteractiveTool(pendingTool.block.name);
    }
  }

  return false;
}

// Get the last message info for action payloads
function getLastMessageInfo(messages: Message[]): { id: string; ts: number } | null {
  if (messages.length === 0) return null;
  const last = messages[messages.length - 1];
  return {
    id: last.uuid,
    ts: new Date(last.timestamp).getTime(),
  };
}

function ChatContent({ sessionId }: { sessionId: string }) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const { isReady } = useStoreContext();
  const { messages, isLoadingMessages } = useMessages(sessionId);
  const [inputText, setInputText] = useState('');
  const [inputHeight, setInputHeight] = useState(44);
  const [inputFocused, setInputFocused] = useState(false);
  const [mode, setMode] = useState<PromptMode>('default');
  const [model, setModel] = useState<ModelId>('default');
  const inputRef = useRef<TextInput>(null);

  // Loading state: store not ready OR actively loading closed session messages
  const isLoading = !isReady || isLoadingMessages;

  const { sendPrompt, stopAgent, approveToolUse, actionStates } = useUserActions();
  const isSubmitting =
    actionStates.sendPrompt.isLoading ||
    actionStates.approveToolUse.isLoading;
  const isStopping = actionStates.stopAgent.isLoading;

  const pendingQuestionContext = usePendingQuestion();
  const {
    hasSelections,
    getSelectionSummary,
    clearSelections,
    setPendingQuestion,
    selections,
    isSubmitting: contextIsSubmitting,
    setIsSubmitting,
  } = pendingQuestionContext;

  // Detect pending interactive tool from messages
  const pendingTool = useMemo(() => {
    if (messages.length === 0) return null;
    return findPendingInteractiveTool(messages);
  }, [messages]);

  // Detect if agent is running
  const agentRunning = useMemo(() => isAgentRunning(messages), [messages]);

  // Update context when pending tool changes
  useEffect(() => {
    if (pendingTool?.type === 'AskUserQuestion') {
      setPendingQuestion(pendingTool.questions, pendingTool.toolUseId);
    } else if (pendingTool?.type === 'ExitPlanMode') {
      // For ExitPlanMode, we use the context to track the selection (using question index 0)
      // We don't actually have questions, but we can use the same mechanism
      setPendingQuestion(null, pendingTool.toolUseId);
    } else if (pendingTool?.type === 'ToolPermission') {
      // For ToolPermission, we also use context to track the selection
      setPendingQuestion(null, pendingTool.toolUseId);
    } else {
      setPendingQuestion(null, null);
    }
  }, [pendingTool, setPendingQuestion]);

  // Get the current selection for plan approval
  const planApprovalSelection = useMemo(() => {
    if (pendingTool?.type !== 'ExitPlanMode') return null;
    return selections.get(0) as PlanApprovalResponse | undefined;
  }, [pendingTool, selections]);

  // Get the current selection for tool approval
  const toolApprovalSelection = useMemo(() => {
    if (pendingTool?.type !== 'ToolPermission') return null;
    return selections.get(0) as ToolApprovalResponse | undefined;
  }, [pendingTool, selections]);

  // Check if any AskUserQuestion has "Other" selected
  const hasOtherSelected = useMemo(() => {
    if (pendingTool?.type !== 'AskUserQuestion') return false;
    for (const [, selection] of selections) {
      if (selection === OTHER_OPTION) return true;
    }
    return false;
  }, [pendingTool, selections]);

  // Focus input when "Other" is selected or "Provide feedback" is selected
  useEffect(() => {
    if (hasOtherSelected || planApprovalSelection === 'feedback') {
      inputRef.current?.focus();
    }
  }, [hasOtherSelected, planApprovalSelection]);

  // Determine placeholder text
  const placeholder = useMemo(() => {
    if (pendingTool?.type === 'ExitPlanMode') {
      if (planApprovalSelection) {
        const option = PLAN_APPROVAL_OPTIONS.find((o) => o.value === planApprovalSelection);
        if (planApprovalSelection === 'feedback') {
          return 'Type your feedback...';
        }
        return `Send: "${option?.label || planApprovalSelection}"`;
      }
      return 'Select an approval option...';
    }

    if (pendingTool?.type === 'ToolPermission') {
      if (toolApprovalSelection) {
        const labels: Record<string, string> = {
          'approve-once': 'Yes',
          'approve-always': 'Yes, always',
          'reject': 'No',
        };
        return `Send: "${labels[toolApprovalSelection] || toolApprovalSelection}"`;
      }
      return 'Select an option above...';
    }

    // For AskUserQuestion with "Other" selected, prompt for text input
    if (hasOtherSelected) {
      return 'Type your response...';
    }

    if (hasSelections) {
      const summary = getSelectionSummary();
      // Truncate if too long
      const truncated = summary.length > 40 ? summary.slice(0, 40) + '...' : summary;
      return `Send: "${truncated}"`;
    }

    if (pendingTool?.type === 'AskUserQuestion') {
      return 'Select an option above...';
    }

    return 'Send a message...';
  }, [hasSelections, hasOtherSelected, getSelectionSummary, pendingTool, planApprovalSelection, toolApprovalSelection]);

  // Handle text input change
  const handleTextChange = (text: string) => {
    setInputText(text);
    // Note: We no longer clear selections when typing because "Other" text
    // is now handled per-question in the AskUserQuestionDisplay component
  };

  // Handle stop button press
  const handleStop = async () => {
    const lastMsg = getLastMessageInfo(messages);

    const payload = {
      sessionId,
      lastMessageId: lastMsg?.id,
      lastMessageTs: lastMsg?.ts,
    };
    console.log('Submitting stopAgent:', JSON.stringify(payload, null, 2));

    try {
      await stopAgent(payload);
    } catch (err) {
      console.error('Failed to stop agent:', err);
    }
  };

  // Handle submit
  const handleSubmit = async () => {
    const lastMsg = getLastMessageInfo(messages);

    setIsSubmitting(true);

    // Handle ExitPlanMode submission
    if (pendingTool?.type === 'ExitPlanMode' && planApprovalSelection) {
      // Map the plan approval selection to numeric options (matching Claude CLI):
      // 1 = Yes, clear context and bypass permissions
      // 2 = Yes, and manually approve edits
      // 3 = Yes, and bypass permissions
      // 4 = Yes, manually approve edits
      // 5 = Feedback (requires text)
      const planOptionMap: Record<string, 1 | 2 | 3 | 4 | 5> = {
        'clear-bypass': 1,
        manual: 2,
        bypass: 3,
        'keep-manual': 4,
        feedback: 5,
      };
      const option = planOptionMap[planApprovalSelection] ?? 3;

      const response: ToolResponse = {
        type: 'plan',
        option,
        text: option === 5 ? inputText.trim() : undefined,
      };

      const payload = {
        sessionId,
        toolUseId: pendingTool.toolUseId,
        toolName: 'ExitPlanMode',
        response,
        lastMessageId: lastMsg?.id,
        lastMessageTs: lastMsg?.ts,
      };
      console.log('Submitting approveToolUse (plan):', JSON.stringify(payload, null, 2));

      try {
        await approveToolUse(payload);
        clearSelections();
        setInputText('');
      } catch (err) {
        console.error('Failed to approve plan:', err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Handle ToolPermission submission
    if (pendingTool?.type === 'ToolPermission' && toolApprovalSelection) {
      // Map the tool approval selection to numeric options:
      // 1 = approve once
      // 2 = approve always
      // 3 = reject
      const toolOptionMap: Record<string, 1 | 2 | 3> = {
        'approve-once': 1,
        'approve-always': 2,
        reject: 3,
      };
      const option = toolOptionMap[toolApprovalSelection] ?? 3;

      const response: ToolResponse = {
        type: 'tool',
        option,
      };

      const payload = {
        sessionId,
        toolUseId: pendingTool.toolUseId,
        toolName: pendingTool.toolName,
        response,
        lastMessageId: lastMsg?.id,
        lastMessageTs: lastMsg?.ts,
      };
      console.log('Submitting approveToolUse (tool):', JSON.stringify(payload, null, 2));

      try {
        await approveToolUse(payload);
        clearSelections();
      } catch (err) {
        console.error('Failed to approve tool use:', err);
        // Show error alert and keep message interactive (don't clear selections)
        const message = err instanceof Error ? err.message : 'Failed to send approval';
        if (Platform.OS === 'web') {
          window.alert(message);
        } else {
          Alert.alert('Error', message);
        }
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Handle AskUserQuestion submission
    if ((hasSelections || hasOtherSelected) && pendingTool?.type === 'AskUserQuestion') {
      const questions = pendingTool.questions;
      const answers: AnswerItem[] = [];

      selections.forEach((selection, questionIndex) => {
        const q = questions[questionIndex];
        if (q) {
          // Handle "Other" selection - use main input text
          if (selection === OTHER_OPTION) {
            if (inputText.trim()) {
              answers.push({
                questionIndex,
                option: -1, // -1 indicates "Other"
                text: inputText.trim(),
              });
            }
          } else {
            // Handle predefined option selections
            const labels = Array.isArray(selection) ? selection : [selection];
            labels.forEach((label) => {
              const optionIndex = q.options.findIndex((opt) => opt.label === label);
              if (optionIndex >= 0) {
                answers.push({
                  questionIndex,
                  option: optionIndex,
                });
              }
            });
          }
        }
      });

      const response: ToolResponse = {
        type: 'answers',
        answers,
      };

      const payload = {
        sessionId,
        toolUseId: pendingTool.toolUseId,
        toolName: 'AskUserQuestion',
        response,
        lastMessageId: lastMsg?.id,
        lastMessageTs: lastMsg?.ts,
      };
      console.log('Submitting approveToolUse (answers):', JSON.stringify(payload, null, 2));

      try {
        await approveToolUse(payload);
        clearSelections();
        setInputText('');
      } catch (err) {
        console.error('Failed to send answers:', err);
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    // Handle regular message (not responding to AskUserQuestion)
    if (inputText.trim() && !pendingTool) {
      const payload = {
        sessionId,
        text: inputText.trim(),
        model,
        mode,
        lastMessageId: lastMsg?.id,
        lastMessageTs: lastMsg?.ts,
      };
      console.log('Submitting sendPrompt:', JSON.stringify(payload, null, 2));

      try {
        await sendPrompt(payload);
        setInputText('');
      } catch (err) {
        console.error('Failed to send prompt:', err);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // No action taken, reset submitting state
      setIsSubmitting(false);
    }
  };

  // Determine if we can submit
  const canSubmit = useMemo(() => {
    if (isSubmitting || contextIsSubmitting) return false;

    // For ExitPlanMode
    if (pendingTool?.type === 'ExitPlanMode' && planApprovalSelection) {
      // If feedback is selected, need text input
      if (planApprovalSelection === 'feedback') {
        return inputText.trim().length > 0;
      }
      return true;
    }

    // For ToolPermission - must have a selection
    if (pendingTool?.type === 'ToolPermission') {
      return !!toolApprovalSelection;
    }

    // For AskUserQuestion - must have selections
    // If "Other" is selected, require text input
    if (pendingTool?.type === 'AskUserQuestion') {
      if (hasOtherSelected) {
        return inputText.trim().length > 0;
      }
      return hasSelections;
    }

    // For regular messages
    return inputText.trim().length > 0;
  }, [pendingTool, planApprovalSelection, toolApprovalSelection, hasSelections, hasOtherSelected, inputText, isSubmitting, contextIsSubmitting]);

  // Handle key press for web (Enter to submit, Shift+Enter for newline)
  const handleKeyPress = (e: { nativeEvent: { key: string; shiftKey?: boolean } }) => {
    if (Platform.OS !== 'web') return;

    const { key, shiftKey } = e.nativeEvent;
    if (key === 'Enter' && !shiftKey) {
      // Prevent default to avoid newline
      (e as unknown as { preventDefault?: () => void }).preventDefault?.();
      if (canSubmit) {
        handleSubmit();
      }
    }
    // Shift+Enter allows default behavior (newline)
  };

  return (
    <View className="bg-background flex-1">
      {/* Messages area */}
      <View className="flex-1">
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-muted-foreground">Loading messages...</Text>
          </View>
        ) : messages.length > 0 ? (
          <MessageList messages={messages} />
        ) : (
          <View className="flex-1 items-center justify-center gap-4 p-6">
            <View className="bg-muted rounded-full p-4">
              <Icon as={MessageSquareIcon} className="text-muted-foreground size-8" />
            </View>
            <Text className="text-muted-foreground text-center">No messages yet</Text>
          </View>
        )}
      </View>

      {/* Input area - sticks above keyboard */}
      <KeyboardStickyView offset={{ opened: 0, closed: 0 }}>
        {/* Mode/Model Bar - only show when not responding to interactive tools */}
        {!pendingTool && (
          <ModeModelBar
            mode={mode}
            model={model}
            onModeChange={setMode}
            onModelChange={setModel}
            disabled={isSubmitting}
            visible={inputFocused}
          />
        )}

        <View className="border-border bg-background flex-row items-end gap-2 border-t p-4">
          <TextInput
            testID="message-input"
            ref={inputRef}
            placeholder={placeholder}
            placeholderTextColor={
              hasSelections || hasOtherSelected || planApprovalSelection || toolApprovalSelection
                ? colors.primary
                : colors.mutedForeground
            }
            value={inputText}
            onChangeText={handleTextChange}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            onKeyPress={handleKeyPress}
            editable={!isSubmitting && !contextIsSubmitting}
            className="border-border bg-background text-foreground flex-1 rounded-lg border px-4 py-3"
            multiline
            onContentSizeChange={(e) => {
              const height = e.nativeEvent.contentSize.height; // account for padding
              setInputHeight(Math.min(Math.max(44, height), 120));
            }}
            style={{ height: inputHeight }}
          />

          {/* Show stop button when agent is running, send button otherwise */}
          {agentRunning && !pendingTool ? (
            <StopButton onPress={handleStop} isLoading={isStopping} disabled={isStopping} />
          ) : (
            <Pressable
              testID="send-button"
              onPress={handleSubmit}
              disabled={!canSubmit}
              className="bg-primary rounded-lg p-3 active:opacity-80 disabled:opacity-50">
              {contextIsSubmitting ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                <Icon as={SendIcon} className="text-primary-foreground size-5" />
              )}
            </Pressable>
          )}
        </View>
      </KeyboardStickyView>
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();

  if (!id) {
    return (
      <View className="bg-background flex-1 items-center justify-center">
        <Text className="text-muted-foreground">No session selected</Text>
      </View>
    );
  }

  return (
    <PendingQuestionProvider>
      <ChatContent sessionId={id} />
    </PendingQuestionProvider>
  );
}
