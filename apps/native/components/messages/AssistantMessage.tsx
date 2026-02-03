import { ProviderIcon } from '@/components/sessions/ProviderIcon';
import { Text } from '@/components/ui/text';
import { View } from 'react-native';

interface AssistantMessageProps {
  text: string;
  providerId?: string;
}

export function AssistantMessage({ text, providerId = 'claude' }: AssistantMessageProps) {
  return (
    <View className="border-border bg-card flex-row items-start gap-2 rounded-sm border px-2.5 py-1.5">
      <View className="mt-0.5 shrink-0">
        <ProviderIcon providerId={providerId} size={16} showBackground={false} />
      </View>
      <Text className="text-foreground flex-1 text-sm leading-relaxed">{text}</Text>
    </View>
  );
}
