import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import type { QueueOperationMessage } from '@/lib/types/session';
import { cn } from '@/lib/utils';
import { AlertCircleIcon, CheckCircle2Icon, PlayCircleIcon } from 'lucide-react-native';
import { View } from 'react-native';

interface TaskNotificationDisplayProps {
  message: QueueOperationMessage;
}

interface ParsedNotification {
  taskId: string;
  status: 'running' | 'completed' | 'failed';
  summary: string;
}

function parseTaskNotification(content: string): ParsedNotification | null {
  // Parse content like:
  // <task-notification>
  // <task-id>bbd6098</task-id>
  // <status>failed</status>
  // <summary>Background command failed with exit code 137.</summary>
  // </task-notification>

  const taskIdMatch = content.match(/<task-id>([^<]+)<\/task-id>/);
  const statusMatch = content.match(/<status>([^<]+)<\/status>/);
  const summaryMatch = content.match(/<summary>([^<]+)<\/summary>/);

  if (!taskIdMatch || !statusMatch) {
    return null;
  }

  const status = statusMatch[1] as 'running' | 'completed' | 'failed';

  return {
    taskId: taskIdMatch[1],
    status,
    summary: summaryMatch?.[1] || '',
  };
}

export function TaskNotificationDisplay({ message }: TaskNotificationDisplayProps) {
  const notification = parseTaskNotification(message.content);

  if (!notification) {
    return null;
  }

  const statusConfig = {
    running: {
      icon: PlayCircleIcon,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      label: 'Running',
    },
    completed: {
      icon: CheckCircle2Icon,
      color: 'text-green-500',
      bgColor: 'bg-green-500/10',
      borderColor: 'border-green-500/30',
      label: 'Completed',
    },
    failed: {
      icon: AlertCircleIcon,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
      borderColor: 'border-destructive/30',
      label: 'Failed',
    },
  };

  const config = statusConfig[notification.status];
  const StatusIcon = config.icon;

  return (
    <View
      className={cn(
        'flex-row items-center gap-2 rounded-sm border px-3 py-2',
        config.bgColor,
        config.borderColor
      )}>
      <Icon as={StatusIcon} className={cn('size-4', config.color)} />
      <View className="flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className={cn('text-sm font-medium', config.color)}>
            Task {notification.taskId}
          </Text>
          <View className={cn('rounded-full px-1.5 py-0.5', config.bgColor)}>
            <Text className={cn('text-xs', config.color)}>{config.label}</Text>
          </View>
        </View>
        {notification.summary ? (
          <Text className="text-muted-foreground text-xs">{notification.summary}</Text>
        ) : null}
      </View>
    </View>
  );
}
