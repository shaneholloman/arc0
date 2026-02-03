import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  interpolate,
  Easing,
} from 'react-native-reanimated';

interface ShimmerProps {
  children: React.ReactNode;
  isShimmering?: boolean;
  duration?: number;
}

export function Shimmer({ children, isShimmering = true, duration = 1500 }: ShimmerProps) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (isShimmering) {
      progress.value = 0;
      progress.value = withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
        -1, // infinite
        false // don't reverse
      );
    } else {
      cancelAnimation(progress);
      progress.value = withTiming(0.5, { duration: 200 }); // Smoothly animate to full opacity
    }
  }, [isShimmering, duration, progress]);

  const animatedStyle = useAnimatedStyle(() => {
    const opacity = interpolate(progress.value, [0, 0.5, 1], [0.4, 1, 0.4]);

    return { opacity };
  });

  return <Animated.View style={[styles.container, animatedStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
