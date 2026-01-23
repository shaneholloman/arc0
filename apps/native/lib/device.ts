/**
 * Device information utilities.
 */

import * as Device from 'expo-device';
import { Platform } from 'react-native';

/**
 * Get a human-readable name for this device.
 */
export async function getDeviceName(): Promise<string> {
  // Try to get device name from expo-device
  const deviceName = Device.deviceName;
  if (deviceName) {
    return deviceName;
  }

  // Fallback: construct from device info
  const brand = Device.brand ?? 'Unknown';
  const model = Device.modelName ?? Device.modelId ?? 'Device';

  if (Platform.OS === 'web') {
    return 'Web Browser';
  }

  return `${brand} ${model}`;
}

/**
 * Get device platform info.
 */
export function getDevicePlatform(): string {
  if (Platform.OS === 'web') {
    return 'web';
  }
  return `${Platform.OS}-${Device.osVersion ?? 'unknown'}`;
}
