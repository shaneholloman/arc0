import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { MessageList } from '@/components/messages';
import { PromptInput } from '@/components/chat';
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
import { useMessages, useSession } from '@/lib/store/hooks';
import { useStoreContext } from '@/lib/store/provider';
import type { Message, PendingPermission, RenderableMessage } from '@/lib/types/session';
import {
  deriveToolState,
  findLatestPendingTool,
  isNonInteractiveTool,
} from '@/lib/utils/tool-state';
import type { ModelId, PromptMode, AnswerItem, ToolResponse } from '@arc0/types';
import { useGlobalSearchParams, useLocalSearchParams } from 'expo-router';
import { MessageSquareIcon } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Keyboard, Platform, Pressable, View } from 'react-native';

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

/**
 * Find the latest pending interactive tool from messages.
 * For AskUserQuestion and ExitPlanMode, we infer from message content.
 * For ToolPermission, we require an explicit permission request from the daemon.
 *
 * @param messages - Session messages
 * @param pendingPermission - Explicit permission request from daemon (null if none)
 */
function findPendingInteractiveTool(
  messages: Message[],
  pendingPermission: PendingPermission | null
): PendingInteractiveTool | null {
  if (messages.length === 0) return null;

  const { pendingToolUses } = deriveToolState(messages);
  if (pendingToolUses.length === 0) return null;

  // Walk backward from latest pending tool_use, skipping non-interactive tools.
  // For permission-gated tools, only show prompt when we have an explicit permission_request
  // that matches the toolUseId. If the newest pending tool_use needs permission but we don't
  // have a matching permission_request yet, return null (don't fall back to older tools).
  for (let i = pendingToolUses.length - 1; i >= 0; i--) {
    const toolUse = pendingToolUses[i].block;

    // AskUserQuestion is always interactive (handled via tool input, not permission hook)
    if (toolUse.name === 'AskUserQuestion' && toolUse.input?.questions) {
      return {
        type: 'AskUserQuestion',
        questions: toolUse.input.questions as Question[],
        toolUseId: toolUse.id,
      };
    }

    // ExitPlanMode is always interactive (plan approval)
    if (toolUse.name === 'ExitPlanMode') {
      return {
        type: 'ExitPlanMode',
        planFilePath: toolUse.input?.planFilePath as string | undefined,
        toolUseId: toolUse.id,
      };
    }

    // Non-interactive tools never need approval; skip and keep looking.
    if (isNonInteractiveTool(toolUse.name)) {
      continue;
    }

    // For other tools, only show permission prompt if daemon sent explicit permission_request.
    if (pendingPermission && pendingPermission.toolUseId === toolUse.id) {
      return {
        type: 'ToolPermission',
        toolName: pendingPermission.toolName,
        toolUseId: pendingPermission.toolUseId,
        input: pendingPermission.toolInput,
      };
    }

    return null;
  }

  return null;
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

// Type guard to filter only user/assistant messages (excludes system, queue-operation)
function isUserOrAssistantMessage(msg: RenderableMessage): msg is Message {
  return msg.type === 'user' || msg.type === 'assistant';
}

function ChatContent({ sessionId }: { sessionId: string }) {
  const { isReady } = useStoreContext();
  const { messages, isLoadingMessages } = useMessages(sessionId);
  const session = useSession(sessionId);
  const [inputText, setInputText] = useState('');
  const [mode, setMode] = useState<PromptMode>('default');
  const [model, setModel] = useState<ModelId>('default');

  // Loading state: store not ready OR actively loading closed session messages
  const isLoading = !isReady || isLoadingMessages;

  const { sendPrompt, stopAgent, approveToolUse, actionStates } = useUserActions();
  const isSubmitting = actionStates.sendPrompt.isLoading || actionStates.approveToolUse.isLoading;
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

  // Filter to only user/assistant messages for functions that need Message[] type
  const userAssistantMessages = useMemo(
    () => messages.filter(isUserOrAssistantMessage),
    [messages]
  );

  // Detect pending interactive tool from messages and explicit permission requests
  const pendingTool = useMemo(() => {
    if (userAssistantMessages.length === 0) return null;
    return findPendingInteractiveTool(userAssistantMessages, session?.pendingPermission ?? null);
  }, [userAssistantMessages, session?.pendingPermission]);

  // Detect if agent is running
  const agentRunning = useMemo(
    () => isAgentRunning(userAssistantMessages),
    [userAssistantMessages]
  );

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
          reject: 'No',
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
  }, [
    hasSelections,
    hasOtherSelected,
    getSelectionSummary,
    pendingTool,
    planApprovalSelection,
    toolApprovalSelection,
  ]);

  // Handle text input change
  const handleTextChange = (text: string) => {
    setInputText(text);
    // Note: We no longer clear selections when typing because "Other" text
    // is now handled per-question in the AskUserQuestionDisplay component
  };

  // Handle stop button press
  const handleStop = async () => {
    const lastMsg = getLastMessageInfo(userAssistantMessages);

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
    const lastMsg = getLastMessageInfo(userAssistantMessages);

    setIsSubmitting(true);

    // Handle ExitPlanMode submission
    if (pendingTool?.type === 'ExitPlanMode' && planApprovalSelection) {
      // Map the plan approval selection to numeric options (matching Claude CLI):
      // 1 = Yes, clear context and bypass permissions
      // 2 = Yes, and bypass permissions
      // 3 = Yes, manually approve edits
      // 4 = Feedback (requires text)
      const planOptionMap: Record<string, 1 | 2 | 3 | 4> = {
        'clear-bypass': 1,
        bypass: 2,
        manual: 3,
        feedback: 4,
      };
      const option = planOptionMap[planApprovalSelection] ?? 2;

      const response: ToolResponse = {
        type: 'plan',
        option,
        text: option === 4 ? inputText.trim() : undefined,
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
  }, [
    pendingTool,
    planApprovalSelection,
    toolApprovalSelection,
    hasSelections,
    hasOtherSelected,
    inputText,
    isSubmitting,
    contextIsSubmitting,
  ]);

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
          <Pressable
            className="flex-1 items-center justify-center"
            onPress={() => Keyboard.dismiss()}>
            <Text className="text-muted-foreground">Loading messages...</Text>
          </Pressable>
        ) : messages.length > 0 ? (
          <MessageList messages={messages} providerId={session?.providerId} />
        ) : (
          <Pressable
            className="flex-1 items-center justify-center gap-4 p-6"
            onPress={() => Keyboard.dismiss()}>
            <View className="bg-muted rounded-full p-4">
              <Icon as={MessageSquareIcon} className="text-muted-foreground size-8" />
            </View>
            <Text className="text-muted-foreground text-center">No messages yet</Text>
          </Pressable>
        )}
      </View>

      {/* Prompt input */}
      <PromptInput
        value={inputText}
        onChangeText={handleTextChange}
        placeholder={placeholder}
        highlightPlaceholder={
          hasSelections || hasOtherSelected || !!planApprovalSelection || !!toolApprovalSelection
        }
        onSubmit={handleSubmit}
        canSubmit={canSubmit}
        isSubmitting={contextIsSubmitting}
        editable={!isSubmitting && !contextIsSubmitting}
        mode={mode}
        onModeChange={setMode}
        model={model}
        onModelChange={setModel}
        showSelectors
        agentRunning={agentRunning}
        onStop={handleStop}
        isStopping={isStopping}
        onKeyPress={handleKeyPress}
      />
    </View>
  );
}

export default function ChatScreen() {
  const { id } = useGlobalSearchParams<{ id: string }>();

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
