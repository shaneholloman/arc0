import { AlertCircleIcon, CheckCircleIcon, SettingsIcon, XIcon } from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, AppState, Platform, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { useConnectionState } from '@/lib/socket/provider';

const AUTO_HIDE_DELAY = 4000; // Hide banner after 4 seconds
const SUCCESS_HIDE_DELAY = 3000; // Hide success banner after 3 seconds
const SESSION_KEY = 'arc0_session_active';

type BannerType = 'error' | 'success' | null;

/**
 * A compact banner that briefly shows connection status.
 * - Error: Triggered when app comes to foreground while disconnected
 * - Success: Shown briefly when connection is established
 * Persistent status is shown via the drawer header connection indicator
 * when at least one workstation is configured.
 */
export function ConnectionBanner() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const connectionState = useConnectionState();
  const [bannerType, setBannerType] = useState<BannerType>(null);
  const [displayType, setDisplayType] = useState<BannerType>(null); // Preserved for fade-out rendering
  const [isVisible, setIsVisible] = useState(false); // Controls actual rendering (for fade-out)
  const [fadeAnim] = useState(() => new Animated.Value(0));
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef(AppState.currentState);

  /**
   * State tracking refs:
   * - hadErrorRef: true when in error state (enables "recovered" success toast)
   * - wasConnectedRef: true once we've ever connected (enables "connection dropped" detection)
   * - shownErrorForCycleRef: prevents re-showing error during reconnection attempts
   * - isPageRefreshRef: true if this is a page refresh (web) vs fresh visit
   */
  const hadErrorRef = useRef(false);
  const wasConnectedRef = useRef(false);
  const shownErrorForCycleRef = useRef(false);
  const isPageRefreshRef = useRef(false);

  const hasError = connectionState.status === 'error';

  const showBanner = useCallback((type: BannerType) => {
    setBannerType(type);
    setDisplayType(type);
    setIsVisible(true);

    // Clear any existing timeout
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }

    // Auto-hide after delay
    const delay = type === 'success' ? SUCCESS_HIDE_DELAY : AUTO_HIDE_DELAY;
    hideTimeoutRef.current = setTimeout(() => {
      setBannerType(null);
      hideTimeoutRef.current = null;
    }, delay);
  }, []);

  const hideBanner = useCallback(() => {
    setBannerType(null);
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  // Detect page refresh (web only) using sessionStorage
  useEffect(() => {
    if (Platform.OS === 'web' && typeof sessionStorage !== 'undefined') {
      if (sessionStorage.getItem(SESSION_KEY)) {
        isPageRefreshRef.current = true;
      }
      sessionStorage.setItem(SESSION_KEY, 'true');
    }
  }, []);

  // Show banner when app comes to foreground while there's an error
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState) => {
      // App came to foreground (was background/inactive, now active)
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        if (hasError) {
          showBanner('error');
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasError]); // Intentionally exclude showBanner - it's stable

  // Track connection state and show toasts on transitions
  useEffect(() => {
    const currentStatus = connectionState.status;

    if (currentStatus === 'error') {
      hadErrorRef.current = true;
      // Show error toast if:
      // 1. Connection dropped (was connected before), OR
      // 2. Page refresh and first connection failed (web only)
      const shouldShowError =
        !shownErrorForCycleRef.current && (wasConnectedRef.current || isPageRefreshRef.current);

      if (shouldShowError) {
        shownErrorForCycleRef.current = true;
        showBanner('error');
      }
    } else if (currentStatus === 'connected') {
      // Show success toast if we recovered from error
      if (hadErrorRef.current) {
        showBanner('success');
      }
      hadErrorRef.current = false;
      wasConnectedRef.current = true;
      shownErrorForCycleRef.current = false; // Reset for next disconnect cycle
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionState.status]); // Intentionally exclude showBanner to prevent loops

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);

  // Animate visibility with fade-out support
  useEffect(() => {
    if (bannerType) {
      // Fade in
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: Platform.OS !== 'web',
      }).start();
    } else if (isVisible) {
      // Fade out, then hide
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 150,
        useNativeDriver: Platform.OS !== 'web',
      }).start(({ finished }) => {
        if (finished) {
          setIsVisible(false);
        }
      });
    }
  }, [bannerType, isVisible, fadeAnim]);

  if (!isVisible) return null;

  // Use displayType for rendering (preserved during fade-out)
  const isError = displayType === 'error';
  const message = isError ? 'Error connecting to workstation' : 'Connected to workstation';
  const IconComponent = isError ? AlertCircleIcon : CheckCircleIcon;
  const bgClass = isError ? 'bg-destructive' : 'bg-green-600';
  const textClass = isError ? 'text-destructive-foreground' : 'text-white';

  return (
    <Animated.View
      style={{
        opacity: fadeAnim,
        position: 'absolute',
        top: insets.top,
        left: 0,
        right: 0,
        zIndex: 100,
      }}>
      <View
        className={`mx-auto mt-2 flex-row items-center gap-2 self-center rounded-full ${bgClass} px-3 py-1.5`}>
        <Icon as={IconComponent} className={`size-4 ${textClass}`} />
        <Text className={`text-sm font-medium ${textClass}`} numberOfLines={1}>
          {message}
        </Text>
        {isError && (
          <Pressable
            onPress={() => router.push('/settings')}
            className="rounded p-1 active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Settings">
            <Icon as={SettingsIcon} className={`size-4 ${textClass}`} />
          </Pressable>
        )}
        <Pressable
          onPress={hideBanner}
          className="rounded p-1 active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="Dismiss">
          <Icon as={XIcon} className={`size-4 ${textClass}`} />
        </Pressable>
      </View>
    </Animated.View>
  );
}
