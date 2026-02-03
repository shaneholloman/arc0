/**
 * StatusBar - Displays action feedback at bottom of left pane.
 */

import React from "react";
import { Box, Text } from "ink";
import type { StatusType, CategoryKey } from "../types.js";

interface StatusBarProps {
  message: string | null;
  type: StatusType;
  activeCategory: CategoryKey | null;
}

const typeColors: Record<StatusType, string> = {
  success: "green",
  error: "red",
  warn: "yellow",
  info: "cyan",
};

const typeIcons: Record<StatusType, string> = {
  success: "✓",
  error: "✗",
  warn: "!",
  info: "i",
};

const categoryLabels: Record<CategoryKey, string> = {
  c: "Connection",
  s: "Sessions",
  m: "Messages",
};

export function StatusBar({
  message,
  type,
  activeCategory,
}: StatusBarProps): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      minHeight={4}
    >
      {/* Status message */}
      <Box>
        {message ? (
          <>
            <Text color={typeColors[type]}>{typeIcons[type]}</Text>
            <Text> </Text>
            <Text color={typeColors[type]}>{message}</Text>
          </>
        ) : (
          <Text dimColor>Ready</Text>
        )}
      </Box>

      {/* Navigation hint */}
      <Box marginTop={1}>
        {activeCategory ? (
          <Text dimColor>
            [{categoryLabels[activeCategory]}] Press key or ESC to cancel
          </Text>
        ) : (
          <Text dimColor>Press [c]onnection [s]essions [m]essages [q]uit</Text>
        )}
      </Box>
    </Box>
  );
}
