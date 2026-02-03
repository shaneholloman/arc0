/**
 * PostHog analytics provider for the mobile app.
 * Handles initialization, device identification, and session tracking.
 */

import { useOpenSessions } from '@/lib/store/hooks';
import { useStoreContext } from '@/lib/store/provider';
import PostHog, { PostHogProvider as PHProvider, usePostHog } from 'posthog-react-native';
import { createContext, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { useStore } from 'tinybase/ui-react';

import { getDeviceId, getDeviceProperties } from './device';
import { ScreenTracker } from './screen-tracker';

// PostHog configuration from environment
const POSTHOG_API_KEY =
  process.env.EXPO_PUBLIC_POSTHOG_API_KEY ?? 'phc_TPh6CJJTxUSkNsswaEKSKmWpvEBeTMbEX3PAt1nhfEc';
const POSTHOG_HOST = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com';
const ANALYTICS_OPT_OUT = process.env.EXPO_PUBLIC_ANALYTICS_OPT_OUT === 'true';

// Singleton PostHog client - created once at module load
let posthogClient: PostHog | null = null;

function getPostHogClient(): PostHog | null {
  if (!POSTHOG_API_KEY) return null;

  if (!posthogClient) {
    posthogClient = new PostHog(POSTHOG_API_KEY, {
      host: POSTHOG_HOST,
      // Lifecycle events are useful for session tracking
      captureAppLifecycleEvents: true,
      // Flush after 20 events to avoid too many requests
      flushAt: 20,
      // Error tracking - capture uncaught exceptions and unhandled rejections
      errorTracking: {
        autocapture: {
          uncaughtExceptions: true,
          unhandledRejections: true,
          // Only capture console.error, not warnings
          console: ['error'],
        },
      },
    });

    // Handle opt-out via PostHog's native method (opted in by default)
    if (ANALYTICS_OPT_OUT) {
      posthogClient.optOut();
    }
  }
  return posthogClient;
}

interface AnalyticsContextValue {
  enabled: boolean;
}

const AnalyticsContext = createContext<AnalyticsContextValue>({ enabled: false });

export function useAnalytics() {
  return useContext(AnalyticsContext);
}

interface PostHogProviderProps {
  children: ReactNode;
}

/**
 * PostHog provider that wraps the app with analytics.
 * - Disabled in development mode (__DEV__)
 * - Uses PostHog's optOut() when EXPO_PUBLIC_ANALYTICS_OPT_OUT=true (opted in by default)
 * - Uses device ID for anonymous identification
 * - Tracks screen views via ScreenTracker
 * - Tracks open session count changes
 */
export function PostHogProvider({ children }: PostHogProviderProps) {
  // Completely disabled in development or when no API key
  const isActive = !__DEV__ && !!POSTHOG_API_KEY;
  // Enabled means active and not opted out (for context consumers)
  const enabled = isActive && !ANALYTICS_OPT_OUT;

  const contextValue = useMemo(() => ({ enabled }), [enabled]);

  // Get singleton client (only created once, handles opt-out internally)
  const client = isActive ? getPostHogClient() : null;

  if (!isActive || !client) {
    return <AnalyticsContext.Provider value={contextValue}>{children}</AnalyticsContext.Provider>;
  }

  return (
    <AnalyticsContext.Provider value={contextValue}>
      <PHProvider
        client={client}
        autocapture={{
          // Disable all autocapture as requested
          captureTouches: false,
          captureScreens: false,
        }}>
        <DeviceIdentifier />
        <OpenSessionTracker />
        <ScreenTracker />
        {children}
      </PHProvider>
    </AnalyticsContext.Provider>
  );
}

/**
 * Identifies the device on mount with device properties.
 * Waits for TinyBase store to be ready before identifying to ensure device ID is available.
 */
function DeviceIdentifier() {
  const posthog = usePostHog();
  const { isReady } = useStoreContext();
  const store = useStore();
  const identifiedRef = useRef(false);

  useEffect(() => {
    // Wait for store to be ready before identifying (needed for web fallback)
    if (!posthog || !isReady || identifiedRef.current) return;

    async function identify() {
      // Get device ID (native) or fall back to TinyBase device ID (web)
      let deviceId = await getDeviceId();

      if (!deviceId && store) {
        // Fall back to TinyBase device ID for web
        deviceId = (store.getValue('device') as string | undefined) ?? null;
      }

      if (!deviceId) {
        return;
      }

      // Get device properties
      const properties = getDeviceProperties();

      // Identify with device ID and properties (cast to Record for PostHog)
      posthog.identify(deviceId, {
        $set: properties as unknown as Record<string, string | number | null>,
      });

      identifiedRef.current = true;
    }

    identify();
  }, [posthog, isReady, store]);

  return null;
}

/**
 * Tracks changes in open session count.
 * Waits for TinyBase store to be ready before tracking to avoid false events on startup.
 */
function OpenSessionTracker() {
  const posthog = usePostHog();
  const { isReady } = useStoreContext();
  const openSessions = useOpenSessions();
  const previousCountRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Wait for store to be ready before tracking
    if (!posthog || !isReady) return;

    const currentCount = openSessions.length;

    // On first run after store is ready, just record the initial count without firing an event
    if (!initializedRef.current) {
      previousCountRef.current = currentCount;
      initializedRef.current = true;
      return;
    }

    // Skip if count hasn't changed
    if (previousCountRef.current === currentCount) {
      return;
    }

    // Clear any pending debounce timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce to avoid rapid-fire events during batch updates
    debounceTimerRef.current = setTimeout(() => {
      posthog.capture('session_count_changed', {
        open_count: currentCount,
        previous_count: previousCountRef.current,
      });
      previousCountRef.current = currentCount;
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [posthog, isReady, openSessions.length]);

  return null;
}
