import { Platform, useWindowDimensions } from 'react-native';

// Breakpoints
const PERSISTENT_BREAKPOINT = 680; // Support foldables like Z Fold
const COMPACT_DRAWER_BREAKPOINT = 768; // Below this, use smaller drawer

// Drawer widths
const DRAWER_WIDTH_DEFAULT = 320; // >= 768px (tablets, iPads, desktop)
const DRAWER_WIDTH_COMPACT = 280; // 680-768px (Z Fold, iPad mini)

export function useResponsiveDrawer() {
  const { width } = useWindowDimensions();
  const isWeb = Platform.OS === 'web';
  const isLargeScreen = width >= 1024;
  const isPersistent = width >= PERSISTENT_BREAKPOINT;

  // 320px for tablets+, 280px for foldables/iPad mini
  const drawerWidth =
    width >= COMPACT_DRAWER_BREAKPOINT ? DRAWER_WIDTH_DEFAULT : DRAWER_WIDTH_COMPACT;

  return { isPersistent, isWeb, isLargeScreen, drawerWidth };
}
