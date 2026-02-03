import { FlashList } from '@shopify/flash-list';
import { Text } from '@/components/ui/text';
import { SessionCard } from './SessionCard';
import type { Session } from '@/lib/types/session';
import { View, Pressable } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { useState, useMemo } from 'react';

type ListItem =
  | { type: 'header'; title: string; isExpanded: boolean; count: number }
  | { type: 'session'; session: Session };

interface SessionListProps {
  activeSessions: Session[];
  historicalSessions: Session[];
  selectedSessionId?: string;
  onSessionPress?: () => void;
}

export function SessionList({
  activeSessions,
  historicalSessions,
  selectedSessionId,
  onSessionPress,
}: SessionListProps) {
  const [historicalExpanded, setHistoricalExpanded] = useState(false);

  const data = useMemo(() => {
    const items: ListItem[] = [];

    // Open sessions header (always expanded)
    if (activeSessions.length > 0) {
      items.push({
        type: 'header',
        title: 'Open Sessions',
        isExpanded: true,
        count: activeSessions.length,
      });
      items.push(...activeSessions.map((session) => ({ type: 'session' as const, session })));
    }

    // Closed sessions header (collapsible)
    if (historicalSessions.length > 0) {
      items.push({
        type: 'header',
        title: 'Closed Sessions',
        isExpanded: historicalExpanded,
        count: historicalSessions.length,
      });

      if (historicalExpanded) {
        items.push(...historicalSessions.map((session) => ({ type: 'session' as const, session })));
      }
    }

    return items;
  }, [activeSessions, historicalSessions, historicalExpanded]);

  const renderItem = ({ item }: { item: ListItem }) => {
    if (item.type === 'header') {
      const testID =
        item.title === 'Open Sessions' ? 'open-sessions-section' : 'closed-sessions-section';
      return (
        <Pressable
          testID={testID}
          onPress={() => {
            if (item.title === 'Closed Sessions') {
              setHistoricalExpanded(!historicalExpanded);
            }
          }}
          disabled={item.title === 'Open Sessions'}
          className="flex-row items-center justify-between px-3 py-2">
          <View className="flex-row items-center gap-2">
            {item.title === 'Closed Sessions' && (
              <Icon
                as={item.isExpanded ? ChevronDown : ChevronRight}
                className="text-muted-foreground size-4"
              />
            )}
            <Text className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
              {item.title}
            </Text>
          </View>
          <View className="bg-muted rounded-full px-2 py-0.5">
            <Text className="text-muted-foreground text-xs">{item.count}</Text>
          </View>
        </Pressable>
      );
    }

    return (
      <SessionCard
        session={item.session}
        isSelected={item.session.id === selectedSessionId}
        onPress={onSessionPress}
      />
    );
  };

  const keyExtractor = (item: ListItem) => {
    if (item.type === 'header') {
      return `header-${item.title}`;
    }
    return item.session.id;
  };

  const getItemType = (item: ListItem) => item.type;

  if (activeSessions.length === 0 && historicalSessions.length === 0) {
    return (
      <View testID="session-list-empty" className="flex-1 items-center justify-center p-4">
        <Text className="text-muted-foreground text-center">No sessions yet</Text>
      </View>
    );
  }

  return (
    <FlashList
      testID="session-list"
      data={data}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      getItemType={getItemType}
    />
  );
}
