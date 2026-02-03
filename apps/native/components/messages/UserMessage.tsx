import { Icon } from '@/components/ui/icon';
import { Text } from '@/components/ui/text';
import { UserIcon } from 'lucide-react-native';
import { View } from 'react-native';

interface UserMessageProps {
  text: string;
}

export function UserMessage({ text }: UserMessageProps) {
  return (
    <View className="border-border bg-primary flex-row items-start gap-2 rounded-sm border px-2.5 py-1.5">
      <Icon as={UserIcon} size={16} className="text-primary-foreground mt-0.5 shrink-0" />
      <Text className="text-primary-foreground flex-1 text-sm leading-relaxed">{text}</Text>
    </View>
  );
}
