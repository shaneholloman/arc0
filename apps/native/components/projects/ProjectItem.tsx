import { useMemo } from 'react';
import { View, Pressable } from 'react-native';
import { ChevronDownIcon, ChevronRightIcon, PlusIcon } from 'lucide-react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import type { Session } from '@/lib/types/session';
import { truncatePath, getFolderName } from '@/lib/utils/path';
import { computeAggregateProjectStatus, STATUS_COLORS } from '@/lib/store/session-status';
import { ProjectSessionItem } from './ProjectSessionItem';

interface ProjectItemProps {
  projectId: string;
  projectPath: string;
  sessions: Session[];
  isExpanded: boolean;
  onToggle: () => void;
  onCreateSession: () => void;
  selectedSessionId?: string;
  onSessionPress?: () => void;
}

/**
 * Collapsible project container with sessions.
 */
export function ProjectItem({
  projectId,
  projectPath,
  sessions,
  isExpanded,
  onToggle,
  onCreateSession,
  selectedSessionId,
  onSessionPress,
}: ProjectItemProps) {
  const folderName = getFolderName(projectPath);
  const truncatedPath = truncatePath(projectPath, 30);
  const sessionCount = sessions.length;

  // Compute aggregate project status from session statuses
  const aggregateStatus = useMemo(() => {
    const statuses = sessions.map((s) => s.status);
    return computeAggregateProjectStatus(statuses);
  }, [sessions]);

  return (
    <Collapsible open={isExpanded} onOpenChange={onToggle}>
      <View className="flex-row items-center justify-between px-2 py-2">
        <CollapsibleTrigger className="flex-1 flex-row items-center gap-1">
          <Icon
            as={isExpanded ? ChevronDownIcon : ChevronRightIcon}
            className="text-muted-foreground size-4"
          />
          <View className="flex-1 gap-0.5">
            <View className="flex-row items-center gap-1.5">
              <Text className="text-foreground text-sm font-semibold" numberOfLines={1}>
                {folderName}
              </Text>
              {/* Project status indicator */}
              {aggregateStatus === 'working' && (
                <Spinner size="small" color={STATUS_COLORS.working.hex} />
              )}
              {aggregateStatus === 'attention' && (
                <View className={`size-2 rounded-full ${STATUS_COLORS.ask_user.dot}`} />
              )}
              {aggregateStatus === 'error' && (
                <View className={`size-2 rounded-full ${STATUS_COLORS.error.dot}`} />
              )}
            </View>
            <Text className="text-muted-foreground font-mono text-xs" numberOfLines={1}>
              {truncatedPath} · {sessionCount} session{sessionCount !== 1 ? 's' : ''}
            </Text>
          </View>
        </CollapsibleTrigger>

        <Pressable
          testID={`create-session-${projectId}`}
          accessibilityRole="button"
          accessibilityLabel={`Create new session in ${folderName}`}
          onPress={onCreateSession}
          className="active:bg-accent rounded-lg p-2">
          <Icon as={PlusIcon} className="text-muted-foreground size-4" />
        </Pressable>
      </View>

      <CollapsibleContent>
        {sessions.map((session) => (
          <ProjectSessionItem
            key={session.id}
            session={session}
            isSelected={session.id === selectedSessionId}
            onPress={onSessionPress}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
