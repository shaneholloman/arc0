import type {
  ContentBlock,
  Message,
  QueueOperationMessage,
  RenderableMessage,
  SystemMessage as SystemMessageType,
} from '@/lib/types/session';
import { useScrollToMessageSafe } from '@/lib/contexts/ScrollToMessageContext';
import { useMessage } from '@/lib/store/hooks';
import {
  deriveToolState,
  isNonInteractiveTool,
  type ToolResultWithMetadata,
} from '@/lib/utils/tool-state';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View } from 'react-native';
import { AssistantMessage } from './AssistantMessage';
import { ImageBlockDisplay } from './ImageBlockDisplay';
import { SystemMessage } from './SystemMessage';
import { TaskNotificationDisplay } from './TaskNotificationDisplay';
import { UserMessage } from './UserMessage';
import { ThinkingBlockDisplay } from './ThinkingBlockDisplay';
import { ToolCallBlock } from './ToolCallBlock';

interface MessageListProps {
  messages: RenderableMessage[];
  providerId?: string;
}

interface ContentBlockRendererProps {
  block: ContentBlock;
  isUser: boolean;
  toolResults: Map<string, ToolResultWithMetadata>;
  isInProgress?: boolean;
  isLastMessage?: boolean;
  providerId?: string;
}

function ContentBlockRenderer({
  block,
  isUser,
  toolResults,
  isInProgress,
  isLastMessage,
  providerId,
}: ContentBlockRendererProps) {
  switch (block.type) {
    case 'text':
      return isUser ? (
        <UserMessage text={block.text} />
      ) : (
        <AssistantMessage text={block.text} providerId={providerId} />
      );
    case 'thinking':
      return <ThinkingBlockDisplay thinking={block.thinking} isInProgress={isInProgress} />;
    case 'tool_use': {
      const result = toolResults.get(block.id);
      // Interactive tools are pending tools in the last message that require user input
      // - AskUserQuestion, ExitPlanMode: have custom interactive UI
      // - Other tools (Bash, Read, Write, etc.): show tool permission approval UI
      // - TodoWrite, EnterPlanMode: NOT interactive (no user input needed)
      const isPending = !result;
      const isNonInteractive = isNonInteractiveTool(block.name);
      const isInteractive = isLastMessage && isPending && !isNonInteractive;
      return (
        <ToolCallBlock
          name={block.name}
          input={block.input}
          result={result?.block.content}
          isError={result?.block.is_error}
          metadata={result?.metadata}
          interactive={isInteractive}
          isLastMessage={isLastMessage}
        />
      );
    }
    case 'tool_result':
      // Skip standalone tool_result - it's rendered with its tool_use
      return null;
    case 'image':
      return <ImageBlockDisplay block={block} />;
    default:
      return null;
  }
}

// Type guards for message types
function isUserOrAssistantMessage(msg: RenderableMessage): msg is Message {
  return msg.type === 'user' || msg.type === 'assistant';
}

function isSystemMessage(msg: RenderableMessage): msg is SystemMessageType {
  return msg.type === 'system';
}

function isQueueOperationMessage(msg: RenderableMessage): msg is QueueOperationMessage {
  return msg.type === 'queue-operation';
}

interface RenderableItemProps {
  /** Message ID for TinyBase lookup (user/assistant/system messages) */
  messageId?: string;
  /** Direct message object for non-TinyBase messages (queue-operation) */
  message?: RenderableMessage;
  toolResults: Map<string, ToolResultWithMetadata>;
  isLastMessage?: boolean;
  providerId?: string;
}

/**
 * Renders a single message item.
 * Uses useMessage(id) for TinyBase-stored messages to get reactive updates.
 * This ensures stdout/stderr updates from late-arriving outputs trigger re-renders.
 */
const RenderableItem = React.memo(function RenderableItem({
  messageId,
  message: directMessage,
  toolResults,
  isLastMessage,
  providerId,
}: RenderableItemProps) {
  // For TinyBase messages, fetch reactively via useMessage
  // This ensures updates to stdout/stderr trigger re-renders
  const reactiveMessage = useMessage(messageId ?? '');

  // Use reactive message if we have an ID, otherwise use direct message
  const message = messageId ? reactiveMessage : directMessage;

  if (!message) {
    return null;
  }

  // Handle system messages
  if (isSystemMessage(message)) {
    return (
      <View className="px-2">
        <SystemMessage message={message} />
      </View>
    );
  }

  // Handle queue operation messages
  if (isQueueOperationMessage(message)) {
    return (
      <View className="px-2">
        <TaskNotificationDisplay message={message} />
      </View>
    );
  }

  // Handle user/assistant messages
  if (isUserOrAssistantMessage(message)) {
    const isUser = message.type === 'user';

    // Filter out tool_result blocks since they're rendered with tool_use
    const visibleBlocks = message.content.filter((block) => block.type !== 'tool_result');

    if (visibleBlocks.length === 0) {
      return null;
    }

    return (
      <View className="gap-2 px-2">
        {visibleBlocks.map((block, index) => (
          <ContentBlockRenderer
            key={`${message.uuid}-${index}`}
            block={block}
            isUser={isUser}
            toolResults={toolResults}
            isInProgress={message.isInProgress}
            isLastMessage={isLastMessage}
            providerId={providerId}
          />
        ))}
      </View>
    );
  }

  return null;
});

function ItemSeparator() {
  return <View className="h-2" />;
}

export function MessageList({ messages, providerId }: MessageListProps) {
  const listRef = useRef<FlashListRef<RenderableMessage>>(null);
  const scrollContext = useScrollToMessageSafe();

  // Build a map of tool_use_id -> tool_result with metadata for pairing
  const toolResults = useMemo(() => {
    const messageList = messages.filter(isUserOrAssistantMessage);
    return deriveToolState(messageList).toolResults;
  }, [messages]);

  // Filter messages for display:
  // - System: Only show renderable subtypes (api_error, compact_boundary, local_command)
  // - Queue operation: Always show
  // - User/Assistant: Filter out messages with only tool_result blocks
  const visibleMessages = useMemo(() => {
    return messages.filter((message) => {
      if (isSystemMessage(message)) {
        // undefined subtype = custom-title or other non-renderable system message
        if (!message.subtype) return false;
        // Only show certain system message subtypes
        return ['api_error', 'compact_boundary', 'local_command'].includes(message.subtype);
      }
      if (isQueueOperationMessage(message)) {
        return true;
      }
      if (isUserOrAssistantMessage(message)) {
        return message.content.some((block) => block.type !== 'tool_result');
      }
      return false;
    });
  }, [messages]);

  // Scroll to a message by UUID
  const scrollToMessage = useCallback(
    (uuid: string) => {
      const index = visibleMessages.findIndex(
        (msg) => (isUserOrAssistantMessage(msg) || isSystemMessage(msg)) && msg.uuid === uuid
      );
      if (index !== -1 && listRef.current) {
        try {
          listRef.current.scrollToIndex({
            index,
            animated: true,
            viewPosition: 0.3, // Position message at 30% from top
          });
        } catch {
          // FlashList may throw if item not yet rendered - ignore silently
        }
      }
    },
    [visibleMessages]
  );

  // Listen to context for cross-tab scroll requests
  useEffect(() => {
    if (scrollContext?.targetMessageUuid) {
      // Small delay to ensure the list is rendered after tab switch
      const timeout = setTimeout(() => {
        scrollToMessage(scrollContext.targetMessageUuid!);
        scrollContext.clearScrollRequest();
      }, 100);
      return () => clearTimeout(timeout);
    }
  }, [scrollContext?.targetMessageUuid, scrollToMessage, scrollContext]);

  // Get a unique key for each message type
  const getMessageKey = (message: RenderableMessage, index: number): string => {
    if (isSystemMessage(message) || isUserOrAssistantMessage(message)) {
      return message.uuid;
    }
    if (isQueueOperationMessage(message)) {
      return `queue-${message.timestamp}`;
    }
    return `unknown-${index}`;
  };

  // Render function that passes messageId for TinyBase messages (reactive)
  // or direct message for queue-operation messages (not in TinyBase)
  const renderItem = useCallback(
    ({ item, index }: { item: RenderableMessage; index: number }) => {
      const isLast = index === visibleMessages.length - 1;

      // Queue operation messages are not stored in TinyBase, pass directly
      if (isQueueOperationMessage(item)) {
        return (
          <RenderableItem
            message={item}
            toolResults={toolResults}
            isLastMessage={isLast}
            providerId={providerId}
          />
        );
      }

      // User/assistant/system messages are in TinyBase, pass ID for reactive updates
      if (isSystemMessage(item) || isUserOrAssistantMessage(item)) {
        return (
          <RenderableItem
            messageId={item.uuid}
            toolResults={toolResults}
            isLastMessage={isLast}
            providerId={providerId}
          />
        );
      }

      return null;
    },
    [visibleMessages.length, toolResults, providerId]
  );

  return (
    <FlashList
      ref={listRef}
      data={visibleMessages}
      renderItem={renderItem}
      keyExtractor={getMessageKey}
      ItemSeparatorComponent={ItemSeparator}
      contentContainerStyle={{ paddingVertical: 8 }}
      maintainVisibleContentPosition={{
        startRenderingFromBottom: true,
        autoscrollToBottomThreshold: 0.2,
      }}
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
    />
  );
}
