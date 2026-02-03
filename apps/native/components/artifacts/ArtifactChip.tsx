import { Badge } from '@/components/ui/badge';
import { Text } from '@/components/ui/text';
import { Icon } from '@/components/ui/icon';
import { Pressable } from 'react-native';
import { PickaxeIcon, MapIcon, type LucideIcon } from 'lucide-react-native';

export type ArtifactType = 'todo' | 'plan';

export interface ArtifactChipConfig {
  type: ArtifactType;
  label: string;
  icon: LucideIcon;
}

export const ARTIFACT_CHIPS: ArtifactChipConfig[] = [
  { type: 'todo', label: 'Tasks', icon: PickaxeIcon },
  { type: 'plan', label: 'Plan', icon: MapIcon },
];

interface ArtifactChipProps {
  chip: ArtifactChipConfig;
  count: number;
  selected: boolean;
  onPress: () => void;
}

export function ArtifactChip({ chip, count, selected, onPress }: ArtifactChipProps) {
  if (count === 0) return null;

  return (
    <Pressable onPress={onPress} className="mx-1">
      <Badge variant={selected ? 'default' : 'secondary'} className="gap-1.5 px-3 py-1.5">
        <Icon
          as={chip.icon}
          className={`size-4 ${selected ? 'text-primary-foreground' : 'text-secondary-foreground'}`}
        />
        <Text>{chip.label}</Text>
        {chip.type !== 'plan' && (
          <Text
            className={selected ? 'text-primary-foreground/70' : 'text-secondary-foreground/70'}>
            {count}
          </Text>
        )}
      </Badge>
    </Pressable>
  );
}
