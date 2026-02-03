import { View } from 'react-native';
import { useUniwind } from 'uniwind';
import { Code } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { getProviderInfo } from '@/lib/constants/providers';

interface ProviderIconProps {
  providerId: string;
  size?: number;
  showBackground?: boolean;
}

export function ProviderIcon({ providerId, size = 18, showBackground = true }: ProviderIconProps) {
  const { theme } = useUniwind();
  const isDark = theme === 'dark';
  const provider = getProviderInfo(providerId);

  // Select theme-appropriate icon
  const ProviderSvg = provider
    ? isDark && provider.IconDark
      ? provider.IconDark
      : provider.Icon
    : null;

  const bgColor = (provider?.color || '#888888') + '20';

  if (showBackground) {
    return (
      <View
        className="size-8 items-center justify-center rounded-md"
        style={{ backgroundColor: bgColor }}>
        {ProviderSvg ? (
          <ProviderSvg width={size} height={size} />
        ) : (
          <Icon as={Code} size={size - 2} color={provider?.color || '#888888'} />
        )}
      </View>
    );
  }

  return ProviderSvg ? (
    <ProviderSvg width={size} height={size} />
  ) : (
    <Icon as={Code} size={size - 2} color={provider?.color || '#888888'} />
  );
}
