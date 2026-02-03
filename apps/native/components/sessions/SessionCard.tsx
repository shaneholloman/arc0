import { View, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { FolderIcon, GitBranchIcon } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import type { Session } from '@/lib/types/session';
import { useEffectiveSessionStatus } from '@/lib/store/hooks';
import { formatRelativeTimeShort } from '@/lib/utils/time';
import { truncatePath } from '@/lib/utils/path';
import { formatFirstMessageForDisplay } from '@/lib/utils/session-display';
import { STATUS_COLORS, isAnimatedStatus } from '@/lib/store/session-status';

interface SessionCardProps {
  session: Session;
  isSelected?: boolean;
  onPress?: () => void;
}

export function SessionCard({ session, isSelected = false, onPress }: SessionCardProps) {
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

  // Display name: use firstMessage if available, fallback to project folder name
  const displayName = session.firstMessage
    ? formatFirstMessageForDisplay(session.firstMessage)
    : session.name || 'New Session';

  // For idle/ended, show time instead of status label
  const showTime = statusInfo.status === 'idle' || statusInfo.status === 'ended';
  const timeAgo = formatRelativeTimeShort(session.lastMessageAt || session.startedAt);

  // Truncated project path
  const projectPath = truncatePath(session.projectName, 35);

  return (
    <Pressable
      testID={`session-card-${session.id}`}
      accessibilityRole="button"
      accessibilityLabel={`Session: ${displayName}. Status: ${statusInfo.label}`}
      onPress={handlePress}
      className={`border-border mx-2 mb-2 rounded-sm border px-2.5 py-2 active:opacity-80 ${isSelected ? 'bg-card' : 'bg-background'}`}>
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

          {/* Project path */}
          <View className="mt-0.5 flex-row items-center gap-1">
            <Icon as={FolderIcon} className="text-muted-foreground size-3" />
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {projectPath}
            </Text>
          </View>
        </View>
      </View>
    </Pressable>
  );
}
