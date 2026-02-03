import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleIcon,
  TrashIcon,
  WifiIcon,
  WifiOffIcon,
  AlertCircleIcon,
  RefreshCwIcon,
  MessageSquareIcon,
  UsersIcon,
  SendIcon,
  PlayIcon,
  PencilIcon,
  StopCircleIcon,
  ShieldCheckIcon,
} from 'lucide-react-native';
import { useCallback, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import {
  clearEvents,
  getEvents,
  subscribeToEvents,
  type EventType,
  type LoggedEvent,
} from '@/lib/socket/eventLogger';

// Map event types to icons
const EVENT_ICONS: Record<EventType, typeof WifiIcon> = {
  connect: WifiIcon,
  disconnect: WifiOffIcon,
  error: AlertCircleIcon,
  reconnect: RefreshCwIcon,
  sessions: UsersIcon,
  messages: MessageSquareIcon,
  init: SendIcon,
  // User action events
  openSession: PlayIcon,
  sendPrompt: PencilIcon,
  stopAgent: StopCircleIcon,
  approveToolUse: ShieldCheckIcon,
};

// Map event types to colors
const EVENT_COLORS: Record<EventType, string> = {
  connect: 'text-green-500',
  disconnect: 'text-amber-500',
  error: 'text-red-500',
  reconnect: 'text-blue-500',
  sessions: 'text-purple-500',
  messages: 'text-cyan-500',
  init: 'text-teal-500',
  // User action events
  openSession: 'text-emerald-500',
  sendPrompt: 'text-indigo-500',
  stopAgent: 'text-rose-500',
  approveToolUse: 'text-sky-500',
};

interface EventRowProps {
  event: LoggedEvent;
}

function EventRow({ event }: EventRowProps) {
  const EventIcon = EVENT_ICONS[event.type] || CircleIcon;
  const colorClass = EVENT_COLORS[event.type] || 'text-muted-foreground';

  // Direction icon
  const DirectionIcon =
    event.direction === 'in' ? ArrowDownIcon : event.direction === 'out' ? ArrowUpIcon : null;

  const timeStr = event.timestamp.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <View className="border-border flex-row items-start border-b py-2">
      <View className="mr-2 flex-row items-center">
        <Icon as={EventIcon} className={`size-4 ${colorClass}`} />
        {DirectionIcon && (
          <Icon as={DirectionIcon} className="text-muted-foreground ml-0.5 size-3" />
        )}
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="text-xs font-medium">{event.type}</Text>
          <Text className="text-muted-foreground font-mono text-xs">{timeStr}</Text>
        </View>
        <Text className="text-muted-foreground text-xs" numberOfLines={2}>
          {event.summary}
        </Text>
        {event.details && Object.keys(event.details).length > 0 && (
          <Text className="text-muted-foreground mt-0.5 font-mono text-xs" numberOfLines={1}>
            {Object.entries(event.details)
              .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`)
              .join(' ')}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Event Log - Shows recent Socket.IO events for debugging.
 */
export function EventLog() {
  // Subscribe to events using useSyncExternalStore for optimal reactivity
  const events = useSyncExternalStore(subscribeToEvents, getEvents, getEvents);

  const handleClear = useCallback(() => {
    clearEvents();
  }, []);

  return (
    <View>
      <View className="mb-2 flex-row items-center justify-between">
        <Text className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Event Log
        </Text>
        <Pressable
          onPress={handleClear}
          className="active:bg-accent rounded p-1"
          accessibilityRole="button"
          accessibilityLabel="Clear events">
          <Icon as={TrashIcon} className="text-muted-foreground size-4" />
        </Pressable>
      </View>
      <Text className="text-muted-foreground mb-3 text-xs">
        Recent Socket.IO events ({events.length} total)
      </Text>

      {events.length === 0 ? (
        <Text className="text-muted-foreground text-center text-xs italic">
          No events yet. Events will appear here when socket activity occurs.
        </Text>
      ) : (
        <View>
          {events.slice(0, 20).map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
          {events.length > 20 && (
            <Text className="text-muted-foreground mt-2 text-center text-xs">
              ... and {events.length - 20} more events
            </Text>
          )}
        </View>
      )}
    </View>
  );
}
