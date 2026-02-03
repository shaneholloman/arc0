import { View } from 'react-native';
import { useValue } from 'tinybase/ui-react';

import { Text } from '@/components/ui/text';

/**
 * Displays the device UUID from TinyBase values.
 */
export function DeviceInfo() {
  const deviceId = useValue('device') as string | undefined;

  return (
    <View className="mb-3">
      <Text className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
        Device ID
      </Text>
      <View className="bg-muted/50 rounded px-2 py-1">
        <Text className="font-mono text-xs" numberOfLines={1}>
          {deviceId || 'Not set'}
        </Text>
      </View>
    </View>
  );
}
