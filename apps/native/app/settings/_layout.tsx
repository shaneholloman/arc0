import { Pressable } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { XIcon } from 'lucide-react-native';
import { useUniwind } from 'uniwind';

import { THEME } from '@/lib/theme';

export default function SettingsLayout() {
  const { theme } = useUniwind();
  const colors = THEME[theme ?? 'light'];
  const router = useRouter();

  const handleClose = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/');
    }
  };

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        contentStyle: { backgroundColor: colors.background },
        headerBackVisible: true,
        headerTintColor: colors.foreground,
      }}>
      <Stack.Screen
        name="index"
        options={{
          title: 'Settings',
          headerBackVisible: false,
          headerLeft: () => null,
          headerRight: () => (
            <Pressable onPress={handleClose} className="p-2">
              <XIcon size={20} color={colors.mutedForeground} />
            </Pressable>
          ),
        }}
      />
    </Stack>
  );
}
