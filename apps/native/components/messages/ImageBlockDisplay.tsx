import { Text } from '@/components/ui/text';
import type { ImageBlock } from '@/lib/types/session';
import { Image } from 'expo-image';
import { View } from 'react-native';

interface ImageBlockDisplayProps {
  block: ImageBlock;
}

export function ImageBlockDisplay({ block }: ImageBlockDisplayProps) {
  const uri = `data:${block.source.media_type};base64,${block.source.data}`;

  return (
    <View className="border-border bg-muted/30 overflow-hidden rounded-sm border">
      <View className="border-border bg-muted/50 border-b px-3 py-1">
        <Text className="text-muted-foreground text-xs">{block.source.media_type}</Text>
      </View>
      <View className="p-2">
        <Image source={{ uri }} style={{ width: '100%', height: 200 }} contentFit="contain" />
      </View>
    </View>
  );
}
