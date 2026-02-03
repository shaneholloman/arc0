import { AlertTriangleIcon, RefreshCwIcon } from 'lucide-react-native';
import { Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';

interface ErrorFallbackProps {
  error: Error;
  title?: string;
  description?: string;
  onRetry?: () => void;
  showDetails?: boolean;
}

/**
 * A user-friendly error fallback component.
 * Shows error message with retry option.
 */
export function ErrorFallback({
  error,
  title = 'Something went wrong',
  description = 'An unexpected error occurred. Please try again.',
  onRetry,
  showDetails = __DEV__,
}: ErrorFallbackProps) {
  const insets = useSafeAreaInsets();

  return (
    <View
      className="bg-background flex-1 items-center justify-center p-6"
      style={{
        paddingTop: insets.top,
        paddingBottom: insets.bottom,
      }}>
      <Card className="w-full max-w-md">
        <CardHeader className="items-center">
          <View className="bg-destructive/10 mb-4 rounded-full p-4">
            <Icon as={AlertTriangleIcon} className="text-destructive size-8" />
          </View>
          <CardTitle className="text-center">{title}</CardTitle>
          <CardDescription className="text-center">{description}</CardDescription>
        </CardHeader>

        <CardContent className="gap-4">
          {onRetry && (
            <Button onPress={onRetry} className="w-full">
              <Icon as={RefreshCwIcon} className="text-primary-foreground size-4" />
              <Text>Try Again</Text>
            </Button>
          )}

          {showDetails && (
            <View className="bg-muted/50 rounded-lg p-4">
              <Text className="text-muted-foreground mb-2 text-xs font-medium">Error Details</Text>
              <Text className="text-destructive font-mono text-xs" numberOfLines={3}>
                {error.message}
              </Text>
              {error.stack && Platform.OS !== 'web' && (
                <Text
                  className="text-muted-foreground mt-2 font-mono text-xs"
                  numberOfLines={5}
                  ellipsizeMode="tail">
                  {error.stack.split('\n').slice(0, 5).join('\n')}
                </Text>
              )}
            </View>
          )}
        </CardContent>
      </Card>
    </View>
  );
}

/**
 * Full-screen error view for critical failures.
 * Used by StoreProvider when initialization fails.
 */
export function CriticalErrorFallback({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <ErrorFallback
      error={error}
      title="Failed to Initialize"
      description="The app couldn't start properly. This might be a database or storage issue."
      onRetry={onRetry}
      showDetails={__DEV__}
    />
  );
}
