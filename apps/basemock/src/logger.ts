/**
 * Centralized logging system for BaseMock TUI.
 * Provides typed log entries that can be displayed in the LogViewer.
 */

export type LogLevel = "info" | "success" | "warn" | "error";

export interface LogEntry {
  id: number;
  timestamp: Date;
  level: LogLevel;
  message: string;
  details?: string;
}

type LogListener = (entry: LogEntry) => void;

const MAX_LOGS = 500;
let logId = 0;
const logs: LogEntry[] = [];
const listeners: Set<LogListener> = new Set();

function addLog(level: LogLevel, message: string, details?: string): LogEntry {
  const entry: LogEntry = {
    id: ++logId,
    timestamp: new Date(),
    level,
    message,
    details,
  };

  logs.push(entry);

  // Keep only the last MAX_LOGS entries
  if (logs.length > MAX_LOGS) {
    logs.shift();
  }

  // Notify all listeners
  listeners.forEach((listener) => listener(entry));

  return entry;
}

export const logger = {
  info: (message: string, details?: string): LogEntry =>
    addLog("info", message, details),
  success: (message: string, details?: string): LogEntry =>
    addLog("success", message, details),
  warn: (message: string, details?: string): LogEntry =>
    addLog("warn", message, details),
  error: (message: string, details?: string): LogEntry =>
    addLog("error", message, details),

  /**
   * Subscribe to new log entries.
   * Returns an unsubscribe function.
   */
  subscribe: (listener: LogListener): (() => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },

  /**
   * Get all current log entries.
   */
  getAll: (): LogEntry[] => [...logs],

  /**
   * Clear all logs.
   */
  clear: (): void => {
    logs.length = 0;
  },
};

/**
 * Format a log entry for display.
 */
export function formatLogTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}
