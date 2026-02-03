import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { SystemMessage as SystemMessageType } from '@/lib/types/session';
import { AlertCircleIcon, RefreshCwIcon, ScissorsIcon, UserIcon } from 'lucide-react-native';
import { View } from 'react-native';

interface SystemMessageProps {
  message: SystemMessageType;
}

function ApiErrorDisplay({ message }: { message: SystemMessageType }) {
  const errorCode = message.cause?.code || message.error?.cause?.code || 'Unknown';
  const retryAttempt = message.retryAttempt ?? 0;
  const maxRetries = message.maxRetries ?? 10;
  const retryInMs = message.retryInMs ?? 0;

  return (
    <View className="border-destructive/30 bg-destructive/10 flex-row items-center gap-2 rounded-sm border px-3 py-2">
      <Icon as={AlertCircleIcon} className="text-destructive size-4" />
      <View className="flex-1 gap-0.5">
        <Text className="text-destructive text-sm font-medium">Connection Error: {errorCode}</Text>
        <View className="flex-row items-center gap-2">
          <Icon as={RefreshCwIcon} className="text-muted-foreground size-3" />
          <Text className="text-muted-foreground text-xs">
            Retry {retryAttempt}/{maxRetries} in {Math.round(retryInMs / 1000)}s
          </Text>
        </View>
      </View>
    </View>
  );
}

function CompactBoundaryDisplay({ message }: { message: SystemMessageType }) {
  const preTokens = message.compactMetadata?.preTokens ?? 0;

  return (
    <View className="flex-row items-center gap-2 py-2">
      <View className="bg-border h-px flex-1" />
      <View className="bg-muted flex-row items-center gap-1.5 rounded-full px-2.5 py-1">
        <Icon as={ScissorsIcon} className="text-muted-foreground size-3" />
        <Text className="text-muted-foreground text-xs">
          Context compacted ({Math.round(preTokens / 1000)}k tokens)
        </Text>
      </View>
      <View className="bg-border h-px flex-1" />
    </View>
  );
}

function LocalCommandDisplay({ message }: { message: SystemMessageType }) {
  // Use the new commandName/commandArgs fields if available, fallback to parsing content
  const commandName =
    message.commandName ||
    (() => {
      const match = message.content?.match(/<command-name>([^<]+)<\/command-name>/);
      return match?.[1] || message.content || '';
    })();

  const commandArgs = message.commandArgs;
  const stdout = message.stdout;
  const stderr = message.stderr;

  const hasOutput = stdout || stderr;

  return (
    <View className="border-border bg-primary rounded-sm border px-2.5 py-1.5">
      <View className="flex-row items-center gap-2">
        <Icon as={UserIcon} size={16} className="text-primary-foreground" />
        <Text className="text-primary-foreground font-mono text-sm font-medium">{commandName}</Text>
        {commandArgs ? (
          <Text className="text-primary-foreground/70 font-mono text-sm">{commandArgs}</Text>
        ) : null}
      </View>
      {hasOutput ? (
        <View className="border-primary-foreground/20 mt-2 border-t pt-2">
          {stdout ? (
            <Text className="text-primary-foreground/70 font-mono text-xs whitespace-pre-wrap">
              {stdout}
            </Text>
          ) : null}
          {stderr ? (
            <Text className="text-destructive font-mono text-xs whitespace-pre-wrap">{stderr}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

export function SystemMessage({ message }: SystemMessageProps) {
  // Only render certain subtypes - skip internal ones
  switch (message.subtype) {
    case 'api_error':
      return <ApiErrorDisplay message={message} />;
    case 'compact_boundary':
      return <CompactBoundaryDisplay message={message} />;
    case 'local_command':
      return <LocalCommandDisplay message={message} />;
    case 'stop_hook_summary':
    case 'turn_duration':
      // Internal messages - don't render
      return null;
    default:
      return null;
  }
}
