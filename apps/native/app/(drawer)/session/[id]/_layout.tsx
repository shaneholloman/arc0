import { useEffect, useRef } from 'react';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { SessionInfo } from '@/components/sessions/SessionInfo';
import { ScrollToMessageProvider } from '@/lib/contexts/ScrollToMessageContext';
import { useSession } from '@/lib/store/hooks';
import { useStoreContext } from '@/lib/store/provider';
import { handleActiveSessionChange } from '@/lib/store/closed-sessions';
import { THEME } from '@/lib/theme';
import { useResponsiveDrawer } from '@/lib/hooks/useResponsiveDrawer';
import { DrawerActions, useNavigation, useIsFocused } from '@react-navigation/native';
import { Tabs, useLocalSearchParams } from 'expo-router';
import { FileCode, GitBranch, Menu, MessageSquare } from 'lucide-react-native';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';
import { useIndexes, useStore } from 'tinybase/ui-react';

function SessionHeader() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isPersistent } = useResponsiveDrawer();
  const { isReady } = useStoreContext();

  // Get session data from TinyBase store
  const session = useSession(id ?? '');

  // Determine status text: loading vs not found
  const getStatusText = () => {
    if (!isReady) return 'Loading...';
    if (!session) return 'Session not found';
    return null;
  };
  const statusText = getStatusText();

  return (
    <View
      className="border-border bg-background flex-row items-center gap-3 border-b px-4"
      style={{
        paddingTop: Math.max(insets.top, 12),
        paddingBottom: 14,
      }}>
      {!isPersistent && (
        <Pressable
          onPress={() => navigation.getParent()?.dispatch(DrawerActions.openDrawer())}
          className="active:bg-accent rounded-lg p-2">
          <Icon as={Menu} className="text-foreground size-5" />
        </Pressable>
      )}

      {session ? (
        <SessionInfo session={session} context="header" />
      ) : (
        <View className="flex-1">
          <Text className="font-semibold" numberOfLines={1}>
            {id ? `Session ${id.slice(0, 8)}` : 'Unknown Session'}
          </Text>
          <Text className="text-muted-foreground text-xs" numberOfLines={1}>
            {statusText}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function SessionLayout() {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const indexes = useIndexes();
  const isFocused = useIsFocused();
  const previousSessionIdRef = useRef<string>('');
  const { isPersistent, isWeb } = useResponsiveDrawer();

  // Track active session and unload previous session's messages
  useEffect(() => {
    if (store && id) {
      const previousId = previousSessionIdRef.current;

      store.setValue('active_session_id', id);

      // Unload previous session's messages (deferred to let new session load first)
      if (previousId && previousId !== id && indexes) {
        setTimeout(() => {
          handleActiveSessionChange(store, indexes, previousId, id);
        }, 0);
      }

      previousSessionIdRef.current = id;

      return () => {
        store.setValue('active_session_id', '');
      };
    }
  }, [store, id, indexes]);

  // Unmount children when not focused to free memory
  if (!isFocused) {
    return null;
  }

  return (
    <View className="bg-background flex-1">
      <SessionHeader />
      <ScrollToMessageProvider>
        <Tabs
          screenOptions={{
            headerShown: false,
            tabBarHideOnKeyboard: true,
            tabBarStyle: {
              backgroundColor: colors.background,
              borderTopWidth: 1,
              borderTopColor: colors.border,
              ...(isWeb && { height: isPersistent ? 60 : 68 }),
            },
            tabBarItemStyle: {
              paddingVertical: isPersistent ? 6 : 8,
            },
            tabBarActiveTintColor: colors.primary,
            tabBarInactiveTintColor: colors.mutedForeground,
          }}>
          <Tabs.Screen
            name="chat"
            options={{
              title: 'Chat',
              tabBarIcon: ({ color, size }) => <MessageSquare color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="artifacts"
            options={{
              title: 'Artifacts',
              tabBarIcon: ({ color, size }) => <FileCode color={color} size={size} />,
            }}
          />
          <Tabs.Screen
            name="changes"
            options={{
              title: 'Changes',
              tabBarIcon: ({ color, size }) => <GitBranch color={color} size={size} />,
            }}
          />
        </Tabs>
      </ScrollToMessageProvider>
    </View>
  );
}
