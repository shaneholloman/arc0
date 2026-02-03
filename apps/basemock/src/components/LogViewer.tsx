/**
 * LogViewer - Displays scrollable log entries in the right pane.
 */

import React from "react";
import { Box, Text } from "ink";
import type { LogEntry, LogLevel } from "../logger.js";
import { formatLogTime } from "../logger.js";

interface LogViewerProps {
  logs: LogEntry[];
  maxVisible?: number;
  scrollOffset?: number;
}

const levelColors: Record<LogLevel, string> = {
  info: "cyan",
  success: "green",
  warn: "yellow",
  error: "red",
};

const levelIcons: Record<LogLevel, string> = {
  info: "i",
  success: "✓",
  warn: "!",
  error: "✗",
};

export function LogViewer({
  logs,
  maxVisible = 20,
  scrollOffset = 0,
}: LogViewerProps): React.ReactElement {
  const maxOffset = Math.max(0, logs.length - maxVisible);
  const safeScrollOffset = Math.max(0, Math.min(scrollOffset, maxOffset));
  const height = maxVisible + 4;

  const endIndex = logs.length - safeScrollOffset;
  const startIndex = Math.max(0, endIndex - maxVisible);
  const visibleLogs = logs.slice(startIndex, endIndex);

  return (
    <Box
      flexDirection="column"
      height={height}
      borderStyle="single"
      borderColor="gray"
      paddingX={1}
      overflow="hidden"
    >
      <Box marginBottom={1}>
        <Text bold dimColor>
          Logs ({logs.length})
        </Text>
      </Box>

      {visibleLogs.length === 0 ? (
        <Text dimColor>No logs yet...</Text>
      ) : (
        visibleLogs.map((entry) => (
          <Box key={entry.id} flexDirection="row">
            <Text wrap="truncate">
              <Text dimColor>[{formatLogTime(entry.timestamp)}]</Text>
              <Text> </Text>
              <Text color={levelColors[entry.level]}>
                {levelIcons[entry.level]}
              </Text>
              <Text> </Text>
              <Text color={levelColors[entry.level]}>{entry.message}</Text>
              {entry.details && <Text dimColor> {entry.details}</Text>}
            </Text>
          </Box>
        ))
      )}
    </Box>
  );
}
