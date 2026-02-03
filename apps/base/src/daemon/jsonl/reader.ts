/**
 * JSONL file reader and parser.
 * Handles reading entire files or incremental reads from a byte position.
 */

import { readFileSync, statSync, openSync, readSync, closeSync } from "node:fs";
import type { StoredLine } from "./store.js";

/**
 * Parse a single JSONL line into StoredLine format.
 * Extracts timestamp, uuid, and type for filtering.
 */
export function parseJsonlLine(line: string): StoredLine | null {
  if (!line.trim()) return null;

  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;

    // Extract fields needed for filtering
    const type = typeof parsed.type === "string" ? parsed.type : "unknown";
    const timestamp =
      typeof parsed.timestamp === "string" ? parsed.timestamp : "";
    const uuid = typeof parsed.uuid === "string" ? parsed.uuid : undefined;

    return {
      raw: parsed,
      timestamp,
      uuid,
      type,
    };
  } catch {
    // Invalid JSON line - skip
    return null;
  }
}

/**
 * Read and parse an entire JSONL file.
 * Returns array of StoredLines and the final byte position.
 */
export function readJsonlFile(filePath: string): {
  lines: StoredLine[];
  position: number;
} {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines: StoredLine[] = [];

    for (const line of content.split("\n")) {
      const parsed = parseJsonlLine(line);
      if (parsed) {
        lines.push(parsed);
      }
    }

    // Get file size as position for future incremental reads
    const stats = statSync(filePath);

    return { lines, position: stats.size };
  } catch (error) {
    console.error(`[jsonl/reader] Error reading ${filePath}:`, error);
    return { lines: [], position: 0 };
  }
}

/**
 * Read new lines from a JSONL file starting from a byte position.
 * Used for incremental reads when file changes.
 */
export function readJsonlFileFrom(
  filePath: string,
  fromPosition: number,
): { lines: StoredLine[]; position: number } {
  try {
    const stats = statSync(filePath);

    // No new content
    if (stats.size <= fromPosition) {
      return { lines: [], position: fromPosition };
    }

    // Read only the new content
    const fd = openSync(filePath, "r");
    const buffer = Buffer.alloc(stats.size - fromPosition);
    readSync(fd, buffer, 0, buffer.length, fromPosition);
    closeSync(fd);

    const content = buffer.toString("utf-8");

    // Find last newline - only process complete lines
    // Any partial line at end will be read on next iteration
    const lastNewline = content.lastIndexOf("\n");
    if (lastNewline === -1) {
      // No complete lines yet - wait for more content
      return { lines: [], position: fromPosition };
    }

    // Only process content up to and including the last newline
    const completeContent = content.slice(0, lastNewline);
    const lines: StoredLine[] = [];

    for (const line of completeContent.split("\n")) {
      const parsed = parseJsonlLine(line);
      if (parsed) {
        lines.push(parsed);
      }
    }

    // Advance position only past complete lines
    const newPosition = fromPosition + lastNewline + 1;
    return { lines, position: newPosition };
  } catch (error) {
    console.error(
      `[jsonl/reader] Error reading from position ${fromPosition}:`,
      error,
    );
    return { lines: [], position: fromPosition };
  }
}

/**
 * Get file size without reading content.
 */
export function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}
