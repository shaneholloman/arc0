import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { GitBranchIcon } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import type { Session } from '@/lib/types/session';
import { useEffectiveSessionStatus } from '@/lib/store/hooks';
import { formatRelativeTimeShort } from '@/lib/utils/time';
import { formatFirstMessageForDisplay } from '@/lib/utils/session-display';
import { STATUS_COLORS, isAnimatedStatus } from '@/lib/store/session-status';

interface ProjectSessionItemProps {
  session: Session;
  isSelected?: boolean;
  onPress?: () => void;
}

/**
 * Session item within a project list.
 * Similar to SessionCard but indented and without project path (since it's under the project).
 */
export function ProjectSessionItem({
  session,
  isSelected = false,
  onPress,
}: ProjectSessionItemProps) {
  const router = useRouter();
  const statusInfo = useEffectiveSessionStatus(session);
  const colors = STATUS_COLORS[statusInfo.status];
  const isAnimated = isAnimatedStatus(statusInfo.status);

  const handlePress = () => {
    onPress?.();
    router.push({
      pathname: '/session/[id]/chat',
      params: { id: session.id },
    });
  };

  // Display name: use firstMessage if available, fallback to session name
  const displayName = session.firstMessage
    ? formatFirstMessageForDisplay(session.firstMessage)
    : session.name || 'New Session';

  // For idle/ended, show time instead of status label
  const showTime = statusInfo.status === 'idle' || statusInfo.status === 'ended';
  const timeAgo = formatRelativeTimeShort(session.lastMessageAt || session.startedAt);

  return (
    <Pressable
      testID={`project-session-item-${session.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Session: ${displayName}. Status: ${statusInfo.label}`}
      onPress={handlePress}
      className={`border-border mr-2 mb-2 ml-6 rounded-sm border px-2.5 py-2 active:opacity-80 ${isSelected ? 'bg-card' : 'bg-background'}`}>
      <View className="flex-row items-start gap-2">
        {/* Status indicator */}
        {isAnimated ? (
          <View className="w-5 items-center justify-center pt-0.5">
            <Spinner size="small" color={colors.hex} />
          </View>
        ) : (
          <View className="w-5 items-center justify-center pt-1.5">
            <View className={`size-2.5 rounded-full ${colors.dot}`} />
          </View>
        )}

        {/* Content */}
        <View className="flex-1">
          {/* Session name */}
          <Text className="text-foreground text-sm font-medium" numberOfLines={1}>
            {displayName}
          </Text>

          {/* Status/time and branch */}
          <View className="flex-row items-center gap-2">
            <Text className={`font-mono text-xs ${colors.text}`} numberOfLines={1}>
              {showTime ? timeAgo : statusInfo.label}
            </Text>

            {session.gitBranch && (
              <View className="bg-muted flex-row items-center gap-1 rounded-sm px-1.5 py-0.5">
                <Icon as={GitBranchIcon} className="text-muted-foreground size-3" />
                <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
                  {session.gitBranch}
                </Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Pressable>
  );
}
