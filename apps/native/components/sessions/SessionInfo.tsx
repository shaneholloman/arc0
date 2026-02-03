import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import type { Session } from '@/lib/types/session';
import { View } from 'react-native';
import { Folder } from 'lucide-react-native';
import { ProviderIcon } from './ProviderIcon';
import { truncatePath } from '@/lib/utils/path';
import { formatFirstMessageForDisplay } from '@/lib/utils/session-display';
import { useEffectiveSessionStatus } from '@/lib/store/hooks';
import { STATUS_COLORS } from '@/lib/store/session-status';
import { formatRelativeTimeShort } from '@/lib/utils/time';

interface SessionInfoProps {
  session: Session;
  /** Size variant for different contexts */
  size?: 'default' | 'compact';
  /** Display context affects path truncation length */
  context?: 'list' | 'header';
}

// Path truncation lengths per context
const PATH_MAX_LENGTH = {
  list: 20, // Session cards in list
  header: 40, // Session header
} as const;

/**
 * Shared session info display used in SessionCard and SessionHeader.
 * Shows provider icon, name, status text, and project path.
 */
export function SessionInfo({ session, size = 'default', context = 'list' }: SessionInfoProps) {
  const statusInfo = useEffectiveSessionStatus(session);
  const colors = STATUS_COLORS[statusInfo.status];

  const formattedFirstMessage = session.firstMessage
    ? formatFirstMessageForDisplay(session.firstMessage)
    : null;
  const displayName = session.name || formattedFirstMessage || `Session ${session.id.slice(-8)}`;
  const pathMaxLength = PATH_MAX_LENGTH[context];

  // For idle/ended, show time instead of status label
  const showTime = statusInfo.status === 'idle' || statusInfo.status === 'ended';
  const timeAgo = showTime
    ? formatRelativeTimeShort(session.lastMessageAt || session.startedAt)
    : '';

  const iconSize = size === 'compact' ? 16 : 18;

  return (
    <View className="flex-1 flex-row items-center">
      {/* Provider Icon */}
      <View className="mr-2.5">
        <ProviderIcon providerId={session.providerId} size={iconSize} />
      </View>

      {/* Text content */}
      <View className="flex-1">
        {/* Session name */}
        <Text className="text-sm font-semibold" numberOfLines={1}>
          {displayName}
        </Text>

        {/* Status text · project path (second line) */}
        <View className="-mt-0.5 flex-row items-center">
          <Text className={`font-mono text-xs ${colors.text}`}>
            {showTime ? timeAgo : statusInfo.label}
          </Text>
          <Text className="text-muted-foreground mx-1.5 text-xs">·</Text>
          <Icon as={Folder} className="text-muted-foreground size-3" />
          <Text className="text-muted-foreground ml-1 flex-1 font-mono text-xs" numberOfLines={1}>
            {truncatePath(session.projectName, pathMaxLength)}
          </Text>
        </View>
      </View>
    </View>
  );
}
