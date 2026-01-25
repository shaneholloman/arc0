import React, { useState } from 'react';
import { Text } from '@/components/ui/text';
import { FontAwesome6 } from '@expo/vector-icons';
import { usePathname, useRouter, useGlobalSearchParams } from 'expo-router';
import { Drawer } from 'expo-router/drawer';
import { type DrawerContentComponentProps } from '@react-navigation/drawer';
import { MessageSquareIcon, PlusIcon, SettingsIcon, XIcon } from 'lucide-react-native';
import { ActivityIndicator, Image, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';

import { Icon } from '@/components/ui/icon';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { THEME } from '@/lib/theme';
import { CreateSessionModal, SessionList } from '@/components/sessions';
import { WelcomeEmpty } from '@/components/WelcomeEmpty';
import { useClosedSessions, useOpenSessions, useWorkstations } from '@/lib/store/hooks';
import { useConnectionStatus, useBackgroundConnectedCount, useHasAttemptedInitialConnect } from '@/lib/socket/provider';
import { useStoreContext } from '@/lib/store/provider';
import type { ConnectionStatus } from '@/lib/socket/types';
import { useResponsiveDrawer } from '@/lib/hooks/useResponsiveDrawer';

// Map socket connection status to UI display status
type SyncStatus = 'disconnected' | 'connecting' | 'connected';
function useSyncStatus(): SyncStatus {
  const connectionStatus: ConnectionStatus = useConnectionStatus();
  // Map 'error' to 'disconnected' for UI display
  if (connectionStatus === 'error' || connectionStatus === 'disconnected') {
    return 'disconnected';
  }
  return connectionStatus;
}

function DrawerContent(
  props: DrawerContentComponentProps & { isPersistent?: boolean; selectedSessionId?: string }
) {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const insets = useSafeAreaInsets();
  const { isPersistent, isWeb } = useResponsiveDrawer();
  const syncStatus = useSyncStatus();
  const [activeTab, setActiveTab] = useState<'sessions' | 'projects'>('sessions');
  const [showCreateSession, setShowCreateSession] = useState(false);
  const router = useRouter();
  const { selectedSessionId } = props;
  const { isReady: storeReady } = useStoreContext();
  const hasAttemptedInitialConnect = useHasAttemptedInitialConnect();
  const isInitializing = !storeReady || !hasAttemptedInitialConnect;

  // Multi-workstation data
  const workstations = useWorkstations();
  const backgroundConnectedCount = useBackgroundConnectedCount();
  const hasNoWorkstations = workstations.length === 0;

  // Real TinyBase data - Phase 4 wiring
  const activeSessions = useOpenSessions();
  const historicalSessions = useClosedSessions();

  const handleSessionPress = () => {
    if (!isPersistent) {
      props.navigation.closeDrawer();
    }
  };

  const handleSettingsPress = () => {
    if (!isPersistent) {
      props.navigation.closeDrawer();
    }
    router.push('/settings');
  };

  return (
    <View testID="drawer-content" className="bg-background flex-1">
      <View
        className="border-border border-b px-4"
        style={{
          paddingTop: Math.max(insets.top, 12),
          paddingBottom: 12,
        }}>
        <View className="flex-row items-center justify-between">
          <View>
            <Image
              source={
                theme === 'dark'
                  ? require('@/assets/images/logo-full-dark.png')
                  : require('@/assets/images/logo-full-light.png')
              }
              style={{ width: isWeb ? 120 : 100, height: isWeb ? 36 : 30 }}
              resizeMode="contain"
            />
          </View>
          <View className="flex-row items-center gap-1">
            <View testID="connection-indicator" className="flex-row items-center">
              <View className="p-2">
                <FontAwesome6
                  name={syncStatus === 'connected' ? 'plug-circle-check' : 'plug-circle-xmark'}
                  size={18}
                  color={
                    syncStatus === 'connected'
                      ? '#22c55e' // green
                      : syncStatus === 'connecting'
                        ? '#f59e0b' // amber
                        : '#ef4444' // red
                  }
                />
              </View>
              {/* Show syncing badge when other workstations are connected */}
              {backgroundConnectedCount > 0 && (
                <Text className="text-muted-foreground text-xs">(+{backgroundConnectedCount})</Text>
              )}
            </View>
            {!isPersistent && (
              <Pressable
                onPress={() => props.navigation.closeDrawer()}
                className="active:bg-accent rounded-lg p-2">
                <Icon as={XIcon} className="text-muted-foreground size-5" />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <View style={{ backgroundColor: colors.background, flex: 1 }}>
        {isInitializing ? (
          <View className="flex-1 items-center justify-center gap-6 p-6">
            <ActivityIndicator size="large" color={colors.primary} />
            <View className="gap-2">
              <Text className="text-center text-xl font-semibold">Connecting</Text>
              <Text className="text-muted-foreground text-center">
                Connecting to workstation...
              </Text>
            </View>
          </View>
        ) : hasNoWorkstations && !isPersistent ? (
          // Show setup instructions in drawer only on small screens (non-persistent drawer)
          <WelcomeEmpty compact />
        ) : activeTab === 'sessions' ? (
          <SessionList
            activeSessions={activeSessions}
            historicalSessions={historicalSessions}
            selectedSessionId={selectedSessionId}
            onSessionPress={handleSessionPress}
          />
        ) : (
          <View className="flex-1 items-center justify-center p-4">
            <Text className="text-muted-foreground text-center">Projects view coming soon</Text>
          </View>
        )}
      </View>

      <View
        className="border-border flex-row items-center justify-between border-t px-3"
        style={{
          height: 60 + Math.max(insets.bottom, 0),
          paddingBottom: insets.bottom,
        }}>
        <Tabs
          value={activeTab}
          onValueChange={(value) => value && setActiveTab(value as 'sessions' | 'projects')}>
          <TabsList>
            <TabsTrigger value="sessions" testID="sessions-tab">
              <Text>Sessions</Text>
            </TabsTrigger>
            <TabsTrigger value="projects" testID="projects-tab">
              <Text>Projects</Text>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <View className="flex-row items-center gap-1">
          <Pressable
            testID="create-session-button"
            onPress={() => setShowCreateSession(true)}
            disabled={hasNoWorkstations}
            className="active:bg-accent rounded-lg p-2"
            style={{ opacity: hasNoWorkstations ? 0.3 : 1 }}>
            <Icon as={PlusIcon} className="text-muted-foreground size-5" />
          </Pressable>
          <Pressable
            testID="settings-button"
            onPress={handleSettingsPress}
            className="active:bg-accent rounded-lg p-2">
            <Icon as={SettingsIcon} className="text-muted-foreground size-5" />
          </Pressable>
        </View>
      </View>

      <CreateSessionModal visible={showCreateSession} onClose={() => setShowCreateSession(false)} />
    </View>
  );
}

const MemoizedDrawerContent = React.memo(DrawerContent);

const DrawerContentWrapper = (props: DrawerContentComponentProps & { isPersistent?: boolean }) => {
  const { id: selectedSessionId } = useGlobalSearchParams<{ id?: string }>();
  return <MemoizedDrawerContent {...props} selectedSessionId={selectedSessionId} />;
};

export default function DrawerLayout() {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const pathname = usePathname();
  const { isPersistent, drawerWidth } = useResponsiveDrawer();
  const defaultStatus = isPersistent || pathname === '/' || pathname === '' ? 'open' : 'closed';

  return (
    <Drawer
      defaultStatus={defaultStatus}
      drawerContent={DrawerContentWrapper}
      screenOptions={{
        drawerType: isPersistent ? 'permanent' : 'front',
        drawerStyle: {
          width: isPersistent ? drawerWidth : '100%',
          backgroundColor: colors.background,
        },
        drawerActiveTintColor: colors.primary,
        drawerInactiveTintColor: colors.mutedForeground,
        headerShown: true,
        headerLeft: () => null,
        swipeEnabled: !isPersistent,
        overlayColor: isPersistent ? 'transparent' : undefined,
      }}>
      <Drawer.Screen
        name="index"
        options={{
          title: 'Arc0',
          headerShown: false,
          drawerLabel: 'Home',
          drawerIcon: ({ color, size }) => (
            <MessageSquareIcon color={color} width={size} height={size} />
          ),
        }}
      />
      <Drawer.Screen
        name="session"
        options={{
          title: 'Session',
          headerShown: false,
          drawerItemStyle: { display: 'none' },
        }}
      />
    </Drawer>
  );
}
