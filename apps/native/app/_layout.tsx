import '@/global.css';

import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { useFonts, Geist_400Regular } from '@expo-google-fonts/geist';
import { GeistMono_400Regular } from '@expo-google-fonts/geist-mono';
import { PostHogErrorBoundary, PostHogProvider } from '@/lib/analytics';
import { StatsigProvider } from '@/lib/statsig';
import { ConnectionBanner } from '@/components/ConnectionBanner';
import { NAV_THEME, THEME } from '@/lib/theme';
import { UserActionsProvider } from '@/lib/contexts/UserActionsContext';
import { SocketProvider } from '@/lib/socket/provider';
import { StoreProvider } from '@/lib/store/provider';
import { ThemeProvider } from '@react-navigation/native';
import { PortalHost } from '@rn-primitives/portal';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { useUniwind } from 'uniwind';
import { Pressable } from 'react-native';
import { XIcon } from 'lucide-react-native';

// Keep splash screen visible while loading
SplashScreen.preventAutoHideAsync();

// Configure splash screen animation
SplashScreen.setOptions({
  duration: 500,
  fade: true,
});

export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

function RootStack({ theme }: { theme: 'light' | 'dark' | undefined }) {
  const router = useRouter();
  const colors = THEME[theme ?? 'light'];
  const handleModalClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}>
      <Stack.Screen name="(drawer)" />
      <Stack.Screen
        name="settings"
        options={{
          presentation: 'modal',
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      />
      <Stack.Screen
        name="developers"
        options={{
          presentation: 'modal',
          headerShown: true,
          title: 'Developers',
          headerStyle: { backgroundColor: colors.background },
          contentStyle: { backgroundColor: colors.background },
          headerBackVisible: false,
          headerLeft: () => null,
          headerRight: () => (
            <Pressable onPress={handleModalClose} className="p-2">
              <XIcon size={20} color={colors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const { theme } = useUniwind();
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    GeistMono_400Regular,
  });

  // Hide splash screen when fonts are loaded
  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  // Inject PWA meta tags on web
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const head = document.head;

    // Helper to add element if it doesn't exist
    const addIfMissing = (selector: string, element: HTMLElement) => {
      if (!head.querySelector(selector)) {
        head.appendChild(element);
      }
    };

    // Manifest link
    const manifest = document.createElement('link');
    manifest.rel = 'manifest';
    manifest.href = '/manifest.json';
    addIfMissing('link[rel="manifest"]', manifest);

    // Theme color
    const themeColor = document.createElement('meta');
    themeColor.name = 'theme-color';
    themeColor.content = '#000000';
    addIfMissing('meta[name="theme-color"]', themeColor);

    // Apple mobile web app capable
    const appleCapable = document.createElement('meta');
    appleCapable.name = 'apple-mobile-web-app-capable';
    appleCapable.content = 'yes';
    addIfMissing('meta[name="apple-mobile-web-app-capable"]', appleCapable);

    // Apple status bar style
    const appleStatusBar = document.createElement('meta');
    appleStatusBar.name = 'apple-mobile-web-app-status-bar-style';
    appleStatusBar.content = 'black-translucent';
    addIfMissing('meta[name="apple-mobile-web-app-status-bar-style"]', appleStatusBar);

    // Apple touch icon
    const appleTouchIcon = document.createElement('link');
    appleTouchIcon.rel = 'apple-touch-icon';
    appleTouchIcon.href = '/logo192.png';
    addIfMissing('link[rel="apple-touch-icon"]', appleTouchIcon);
  }, []);

  // Wait for fonts to load
  if (!fontsLoaded) {
    return null;
  }

  const colors = THEME[theme ?? 'light'];

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <View testID="app-root" accessibilityLabel="app-root" accessible={true} style={{ flex: 1 }}>
        <StoreProvider>
          <PostHogProvider>
            <PostHogErrorBoundary>
              <StatsigProvider>
                <SocketProvider>
                  <UserActionsProvider>
                    <KeyboardProvider>
                      <ThemeProvider value={NAV_THEME[theme ?? 'light']}>
                        <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
                        <RootStack theme={theme} />
                        <ConnectionBanner />
                        <PortalHost />
                      </ThemeProvider>
                    </KeyboardProvider>
                  </UserActionsProvider>
                </SocketProvider>
              </StatsigProvider>
            </PostHogErrorBoundary>
          </PostHogProvider>
        </StoreProvider>
      </View>
    </GestureHandlerRootView>
  );
}
