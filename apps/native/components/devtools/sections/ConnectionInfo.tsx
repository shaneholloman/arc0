import { View } from 'react-native';

import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { useConnectionState } from '@/lib/socket/provider';

/**
 * Displays socket connection status and details.
 */
export function ConnectionInfo() {
  const connectionState = useConnectionState();
  const socketUrl = process.env.EXPO_PUBLIC_SOCKET_URL;

  // Map status to badge variant
  const badgeVariant = {
    connected: 'default',
    connecting: 'secondary',
    disconnected: 'outline',
    error: 'destructive',
  }[connectionState.status] as 'default' | 'secondary' | 'outline' | 'destructive';

  // Format last connected time
  const lastConnectedText = connectionState.lastConnected
    ? connectionState.lastConnected.toLocaleTimeString()
    : 'Never';

  return (
    <View className="mb-3">
      <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        Connection
      </Text>

      {/* Status badge and attempts */}
      <View className="mb-1 flex-row items-center gap-2">
        <Badge variant={badgeVariant} className="px-2 py-0.5">
          <Text className="text-xs">{connectionState.status}</Text>
        </Badge>
        {connectionState.reconnectAttempts !== undefined &&
          connectionState.reconnectAttempts > 0 && (
            <Text className="text-muted-foreground text-xs">
              attempt {connectionState.reconnectAttempts}
            </Text>
          )}
      </View>

      {/* Socket URL */}
      <View className="mb-1 flex-row items-center justify-between">
        <Text className="text-muted-foreground text-xs">URL</Text>
        <Text className="font-mono text-xs" numberOfLines={1}>
          {socketUrl || 'Not configured'}
        </Text>
      </View>

      {/* Error if any */}
      {connectionState.error && (
        <View className="bg-destructive/10 mb-1 rounded px-2 py-1">
          <Text className="text-destructive text-xs">{connectionState.error}</Text>
        </View>
      )}

      {/* Last connected */}
      <View className="flex-row items-center justify-between">
        <Text className="text-muted-foreground text-xs">Last connected</Text>
        <Text className="text-xs">{lastConnectedText}</Text>
      </View>
    </View>
  );
}
