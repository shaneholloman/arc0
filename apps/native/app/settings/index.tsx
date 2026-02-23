import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Pressable, Platform, Linking, Alert, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import {
  MoonStarIcon,
  SunIcon,
  MonitorSmartphoneIcon,
  CheckIcon,
  ChevronRightIcon,
  CodeIcon,
  BookOpenIcon,
  MessageCircleIcon,
  GithubIcon,
  RotateCcwIcon,
  ShieldIcon,
  FileTextIcon,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useUniwind } from 'uniwind';
import Constants from 'expo-constants';
import { useStore } from 'tinybase/ui-react';
import { THEME } from '@/lib/theme';
import { useTheme } from '@/lib/store/hooks';
import { useStoreContext } from '@/lib/store/provider';
import { useSocketContext } from '@/lib/socket/provider';
import type { ThemePreference } from '@/lib/store/core';
import { WorkstationList } from '@/components/workstations';
import { clearAllWorkstationCredentials } from '@/lib/settings/workstations';

const DEVTOOLS_ENABLED = process.env.EXPO_PUBLIC_DEVTOOLS_ENABLED === 'true';
const WEB_STORE_FILENAME = 'arc0-store.json';

export default function SettingsScreen() {
  const { theme: resolvedTheme } = useUniwind();
  const { theme: themePreference, setTheme } = useTheme();
  const colors = THEME[resolvedTheme ?? 'light'];
  const insets = useSafeAreaInsets();
  const isWeb = Platform.OS === 'web';
  const router = useRouter();
  const store = useStore();
  const { db } = useStoreContext();
  const { disconnectAll } = useSocketContext();

  // URL params for modal control and deep link pairing
  const params = useLocalSearchParams<{ modal?: string; url?: string; code?: string }>();
  const [openModal, setOpenModal] = useState<string | undefined>(undefined);
  const [modalUrl, setModalUrl] = useState<string | undefined>(undefined);
  const [modalCode, setModalCode] = useState<string | undefined>(undefined);
  const paramsConsumedRef = useRef(false);

  // Capture URL params on mount
  useEffect(() => {
    if (params.modal && !paramsConsumedRef.current) {
      paramsConsumedRef.current = true;
      setOpenModal(params.modal);
      setModalUrl(params.url);
      setModalCode(params.code);
    }
  }, [params.modal, params.url, params.code]);

  // Clear URL params after consumed
  const handleParamsConsumed = useCallback(() => {
    setOpenModal(undefined);
    setModalUrl(undefined);
    setModalCode(undefined);
    // Clear URL params
    router.setParams({ modal: undefined, url: undefined, code: undefined });
  }, [router]);

  const currentTheme: ThemePreference = themePreference ?? 'light';

  // Reset state
  const [isResetting, setIsResetting] = useState(false);

  const handleThemeChange = (option: ThemePreference) => {
    setTheme(option);
  };

  const themeOptions: { value: ThemePreference; label: string; icon: typeof SunIcon }[] = [
    { value: 'light', label: 'Light', icon: SunIcon },
    { value: 'dark', label: 'Dark', icon: MoonStarIcon },
    { value: 'system', label: 'System', icon: MonitorSmartphoneIcon },
  ];

  // Navigation callbacks for workstation sync success
  const handleViewSessions = useCallback(() => {
    router.replace('/');
  }, [router]);

  const handleCreateSession = useCallback(() => {
    router.replace('/');
  }, [router]);

  // Reset app handler
  const handleResetApp = useCallback(() => {
    const performReset = async () => {
      if (!store) return;
      setIsResetting(true);
      let didWipeStorage = false;
      try {
        // Get workstation IDs before clearing (needed for native SecureStore cleanup)
        const workstationIds = store.getRowIds('workstations');

        // Disconnect all workstations
        disconnectAll();

        // Clear workstation credentials FIRST - before wiping persisted storage
        // This ensures if we fail here, data is still intact for retry
        try {
          await clearAllWorkstationCredentials(workstationIds);
        } catch (err) {
          console.error('[reset] Failed to clear workstation credentials:', err);
          // Continue - credentials may be orphaned but this is acceptable
        }

        if (Platform.OS === 'web') {
          try {
            const opfs = await navigator.storage.getDirectory();
            await opfs.removeEntry(WEB_STORE_FILENAME);
          } catch (err) {
            const isNotFound = err instanceof DOMException && err.name === 'NotFoundError';
            if (!isNotFound) {
              throw err;
            }
          }
          didWipeStorage = true;
          window.location.reload();
          return;
        }

        if (!db) {
          throw new Error('Database not initialized');
        }

        const closeAsync = (db as { closeAsync?: () => Promise<void> }).closeAsync;
        if (closeAsync) {
          try {
            await closeAsync();
          } catch (err) {
            console.warn('[reset] Failed to close SQLite database:', err);
          }
        }

        const sqlite = await import('expo-sqlite');
        const deleteDatabaseAsync = (
          sqlite as { deleteDatabaseAsync?: (name: string) => Promise<void> }
        ).deleteDatabaseAsync;
        if (!deleteDatabaseAsync) {
          throw new Error('SQLite deleteDatabaseAsync not available');
        }
        await deleteDatabaseAsync('arc0.db');
        didWipeStorage = true;

        const Updates = await import('expo-updates');
        await Updates.reloadAsync();
        return;
      } catch (err) {
        console.error('[reset] Hard reset failed:', err);
        if (didWipeStorage) {
          if (Platform.OS === 'web') {
            window.alert('Local data cleared. Please reload the page to finish the reset.');
          } else {
            Alert.alert('Reset Complete', 'Local data cleared. Please restart the app.');
          }
        } else if (Platform.OS === 'web') {
          window.alert('Reset failed. Please try again.');
        } else {
          Alert.alert('Reset Failed', 'Please try again.');
        }
      } finally {
        setIsResetting(false);
      }
    };

    if (Platform.OS === 'web') {
      // Web: use window.confirm
      if (
        window.confirm(
          'This will remove all local data, restart the app, and re-fetch from Base services. Continue?'
        )
      ) {
        performReset();
      }
    } else {
      // Native: use Alert
      Alert.alert(
        'Reset App',
        'This will remove all local data, restart the app, and re-fetch from Base services. Continue?',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Reset', style: 'destructive', onPress: performReset },
        ]
      );
    }
  }, [store, db, disconnectAll]);

  return (
    <View
      testID="settings-screen"
      className="bg-background flex-1"
      style={{ paddingBottom: Math.max(insets.bottom, isWeb ? 16 : 12) }}>
      <ScrollView className="flex-1 p-4">
        {/* Workstations Section */}
        <View className="mb-6">
          <WorkstationList
            openModal={openModal === 'add-workstation'}
            initialUrl={modalUrl}
            initialCode={modalCode}
            onParamsConsumed={handleParamsConsumed}
            onViewSessions={handleViewSessions}
            onCreateSession={handleCreateSession}
          />
        </View>

        {/* Reset App (moved outside workstations card) */}
        <View className="bg-card border-border mb-6 overflow-hidden rounded-lg border">
          <Pressable
            testID="reset-app-button"
            onPress={handleResetApp}
            disabled={isResetting}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3"
            style={{ opacity: isResetting ? 0.5 : 1 }}>
            <View className="flex-row items-center gap-3">
              <Icon as={RotateCcwIcon} className="text-destructive size-5" />
              <View>
                <Text className="text-destructive">Reset App</Text>
                <Text className="text-muted-foreground text-sm">
                  {isResetting ? 'Resetting...' : 'Removes all local data'}
                </Text>
              </View>
            </View>
          </Pressable>
        </View>

        <Text className="text-muted-foreground mb-3 text-xs font-semibold tracking-wide uppercase">
          Appearance
        </Text>
        <View
          testID="appearance-section"
          className="bg-card border-border overflow-hidden rounded-lg border">
          {themeOptions.map((option, index) => (
            <Pressable
              key={option.value}
              testID={`theme-${option.value}`}
              onPress={() => handleThemeChange(option.value)}
              className="active:bg-accent flex-row items-center justify-between px-4 py-3"
              style={
                index < themeOptions.length - 1
                  ? { borderBottomWidth: 1, borderBottomColor: colors.border }
                  : undefined
              }>
              <View className="flex-row items-center gap-3">
                <Icon as={option.icon} className="text-foreground size-5" />
                <Text className="text-foreground">{option.label}</Text>
              </View>
              {currentTheme === option.value && (
                <Icon as={CheckIcon} className="text-primary size-5" />
              )}
            </Pressable>
          ))}
        </View>

        <Text className="text-muted-foreground mt-6 mb-3 text-xs font-semibold tracking-wide uppercase">
          Help
        </Text>
        <View
          testID="help-section"
          className="bg-card border-border overflow-hidden rounded-lg border">
          <Pressable
            testID="help-docs"
            onPress={() => Linking.openURL('https://arc0.ai/docs')}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View className="flex-row items-center gap-3">
              <Icon as={BookOpenIcon} className="text-foreground size-5" />
              <Text className="text-foreground">Documentation</Text>
            </View>
            <Icon as={ChevronRightIcon} className="text-muted-foreground size-5" />
          </Pressable>
          <Pressable
            testID="help-discord"
            onPress={() => Linking.openURL('https://arc0.ai/community')}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View className="flex-row items-center gap-3">
              <Icon as={MessageCircleIcon} className="text-foreground size-5" />
              <Text className="text-foreground">Discord</Text>
            </View>
            <Icon as={ChevronRightIcon} className="text-muted-foreground size-5" />
          </Pressable>
          <Pressable
            testID="help-github"
            onPress={() => Linking.openURL('https://github.com/arc0ai/arc0')}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View className="flex-row items-center gap-3">
              <Icon as={GithubIcon} className="text-foreground size-5" />
              <Text className="text-foreground">GitHub</Text>
            </View>
            <Icon as={ChevronRightIcon} className="text-muted-foreground size-5" />
          </Pressable>
          <Pressable
            testID="help-privacy"
            onPress={() => Linking.openURL('https://arc0.ai/privacy')}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3"
            style={{ borderBottomWidth: 1, borderBottomColor: colors.border }}>
            <View className="flex-row items-center gap-3">
              <Icon as={ShieldIcon} className="text-foreground size-5" />
              <Text className="text-foreground">Privacy Policy</Text>
            </View>
            <Icon as={ChevronRightIcon} className="text-muted-foreground size-5" />
          </Pressable>
          <Pressable
            testID="help-terms"
            onPress={() => Linking.openURL('https://arc0.ai/terms')}
            className="active:bg-accent flex-row items-center justify-between px-4 py-3">
            <View className="flex-row items-center gap-3">
              <Icon as={FileTextIcon} className="text-foreground size-5" />
              <Text className="text-foreground">Terms of Service</Text>
            </View>
            <Icon as={ChevronRightIcon} className="text-muted-foreground size-5" />
          </Pressable>
        </View>

        {DEVTOOLS_ENABLED && (
          <>
            <Text className="text-muted-foreground mt-6 mb-3 text-xs font-semibold tracking-wide uppercase">
              Advanced
            </Text>
            <View className="bg-card border-border overflow-hidden rounded-lg border">
              <Pressable
                onPress={() => router.push('/developers')}
                className="active:bg-accent flex-row items-center justify-between px-4 py-3">
                <View className="flex-row items-center gap-3">
                  <Icon as={CodeIcon} className="text-foreground size-5" />
                  <Text className="text-foreground">Developers</Text>
                </View>
                <Icon as={ChevronRightIcon} className="text-muted-foreground size-5" />
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>

      <Text className="text-muted-foreground px-4 text-center text-xs">
        Version {Constants.expoConfig?.version ?? '1.0.0'}
      </Text>
    </View>
  );
}
