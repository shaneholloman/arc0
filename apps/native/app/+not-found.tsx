import { Link } from 'expo-router';
import { View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { AlertCircleIcon } from 'lucide-react-native';

export default function NotFoundScreen() {
  return (
    <View className="bg-background flex-1 items-center justify-center gap-4 p-6">
      <View className="bg-muted rounded-full p-4">
        <Icon as={AlertCircleIcon} className="text-muted-foreground size-8" />
      </View>
      <Text className="text-lg font-semibold">Page Not Found</Text>
      <Text className="text-muted-foreground text-center">This screen doesn&apos;t exist.</Text>
      <Link href="/" asChild>
        <Text className="text-primary underline">Go to home screen</Text>
      </Link>
    </View>
  );
}
