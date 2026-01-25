import { useState, useEffect, useRef } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { TerminalIcon, PlusIcon, MessageSquareIcon } from 'lucide-react-native';

import { CreateSessionModal } from '@/components/sessions';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { WelcomeEmpty } from '@/components/WelcomeEmpty';
import { useConnectionStatus, useHasAttemptedInitialConnect } from '@/lib/socket/provider';
import { useWorkstations, useOpenSessions } from '@/lib/store/hooks';
import { useStoreContext } from '@/lib/store/provider';
import { THEME } from '@/lib/theme';
import { useUniwind } from 'uniwind';

export default function HomeScreen() {
  const router = useRouter();
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const { isReady: storeReady } = useStoreContext();
  const workstations = useWorkstations();
  const connectionStatus = useConnectionStatus();
  const hasAttemptedInitialConnect = useHasAttemptedInitialConnect();
  const openSessions = useOpenSessions();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const hasAutoNavigatedRef = useRef(false);

  // Auto-navigate to first open session when connected
  const firstSessionId = openSessions[0]?.id;
  useEffect(() => {
    if (connectionStatus === 'connected' && firstSessionId && !hasAutoNavigatedRef.current) {
      hasAutoNavigatedRef.current = true;
      router.replace({ pathname: '/session/[id]/chat', params: { id: firstSessionId } });
    }
  }, [connectionStatus, firstSessionId, router]);

  // Reset auto-navigation flag when sessions become empty (allows re-navigation if new session created)
  useEffect(() => {
    if (openSessions.length === 0) {
      hasAutoNavigatedRef.current = false;
    }
  }, [openSessions.length]);

  // Loading: Store not ready OR SocketProvider hasn't done initial check yet
  // This prevents flash of "Add Workstation" before workstations data is fully loaded
  if (!storeReady || !hasAttemptedInitialConnect) {
    return (
      <View className="bg-background flex-1">
        <View className="flex-1 items-center justify-center gap-6 p-6">
          <ActivityIndicator size="large" color={colors.primary} />
          <View className="gap-2">
            <Text className="text-center text-xl font-semibold">Connecting</Text>
            <Text className="text-muted-foreground text-center">
              Connecting to workstation...
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // State 4: No workstation configured (only shown after SocketProvider has checked)
  if (workstations.length === 0) {
    return (
      <View className="bg-background flex-1">
        <WelcomeEmpty />
      </View>
    );
  }

  // State: Socket is actively connecting
  if (connectionStatus === 'connecting') {
    return (
      <View className="bg-background flex-1">
        <View className="flex-1 items-center justify-center gap-6 p-6">
          <ActivityIndicator size="large" color={colors.primary} />
          <View className="gap-2">
            <Text className="text-center text-xl font-semibold">Connecting</Text>
            <Text className="text-muted-foreground text-center">
              Connecting to workstation...
            </Text>
          </View>
        </View>
      </View>
    );
  }

  // State 3: Daemon not running (workstation exists but disconnected/error after connection attempt)
  if (connectionStatus !== 'connected') {
    return (
      <View className="bg-background flex-1">
        <View className="flex-1 items-center justify-center gap-6 p-6">
          <View className="bg-muted rounded-full p-6">
            <Icon as={TerminalIcon} className="text-muted-foreground size-12" />
          </View>

          <View className="gap-2">
            <Text className="text-center text-xl font-semibold">Daemon Not Running</Text>
            <Text className="text-muted-foreground text-center">
              Start the Arc0 daemon on your workstation to sync sessions.
            </Text>
          </View>

          <View className="bg-muted rounded-lg px-4 py-3">
            <Text className="font-mono text-sm">arc0 start</Text>
          </View>
        </View>
      </View>
    );
  }

  // State 2: No open sessions
  if (openSessions.length === 0) {
    return (
      <View className="bg-background flex-1">
        <View className="flex-1 items-center justify-center gap-6 p-6">
          <View className="bg-muted rounded-full p-6">
            <Icon as={MessageSquareIcon} className="text-muted-foreground size-12" />
          </View>

          <View className="gap-2">
            <Text className="text-center text-xl font-semibold">No Active Sessions</Text>
            <Text className="text-muted-foreground text-center">
              Start a new session to begin chatting with Claude.
            </Text>
          </View>

          <Pressable
            onPress={() => setShowCreateModal(true)}
            className="bg-primary flex-row items-center gap-2 rounded-lg px-6 py-3 active:opacity-80">
            <Icon as={PlusIcon} className="text-primary-foreground size-5" />
            <Text className="text-primary-foreground font-medium">Start Session</Text>
          </Pressable>
        </View>

        <CreateSessionModal
          visible={showCreateModal}
          onClose={() => setShowCreateModal(false)}
        />
      </View>
    );
  }

  // State 1: Has open sessions - auto-navigation effect handles redirect
  // Return null to prevent flash while navigation is in-flight
  return null;
}
