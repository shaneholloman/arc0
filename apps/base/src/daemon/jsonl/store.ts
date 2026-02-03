/**
 * In-memory store for JSONL lines per session.
 * Only keeps lines for open/active sessions.
 */

import type { RawMessageEnvelope } from "@arc0/types";

/**
 * Raw JSONL line with minimal parsed fields for filtering.
 */
export interface StoredLine {
  raw: unknown; // Original parsed JSON
  timestamp: string; // For cursor-based filtering
  uuid?: string; // Only present on user/assistant lines
  type: string; // Line type (user, assistant, summary, etc.)
}

/**
 * Session entry in the store.
 */
interface SessionEntry {
  sessionId: string;
  lines: StoredLine[];
  filePath: string;
  filePosition: number; // Byte position for incremental reads
}

/**
 * In-memory store for JSONL content.
 */
class JsonlStore {
  private sessions = new Map<string, SessionEntry>();

  /**
   * Add a new session to the store.
   */
  addSession(
    sessionId: string,
    filePath: string,
    lines: StoredLine[] = [],
  ): void {
    this.sessions.set(sessionId, {
      sessionId,
      lines,
      filePath,
      filePosition: 0,
    });
  }

  /**
   * Remove a session from the store.
   */
  removeSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /**
   * Check if session exists in store.
   */
  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /**
   * Get session entry.
   */
  getSession(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Append lines to a session.
   */
  appendLines(sessionId: string, lines: StoredLine[]): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lines.push(...lines);
    }
  }

  /**
   * Update file position for incremental reads.
   */
  updateFilePosition(sessionId: string, position: number): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.filePosition = position;
    }
  }

  /**
   * Get file position for a session.
   */
  getFilePosition(sessionId: string): number {
    return this.sessions.get(sessionId)?.filePosition ?? 0;
  }

  /**
   * Get all lines for a session.
   */
  getAllLines(sessionId: string): StoredLine[] {
    return this.sessions.get(sessionId)?.lines ?? [];
  }

  /**
   * Get lines after a given timestamp.
   * Used for cursor-based sync.
   */
  getLinesSince(sessionId: string, lastMessageTs: string): StoredLine[] {
    const session = this.sessions.get(sessionId);
    if (!session) return [];

    if (!lastMessageTs) {
      // No cursor - return all lines
      return session.lines;
    }

    // Filter lines with timestamp > lastMessageTs
    return session.lines.filter((line) => line.timestamp > lastMessageTs);
  }

  /**
   * Wrap lines as RawMessageEnvelopes for sending.
   */
  wrapAsEnvelopes(
    sessionId: string,
    lines: StoredLine[],
  ): RawMessageEnvelope[] {
    return lines.map((line) => ({
      sessionId,
      payload: line.raw,
    }));
  }

  /**
   * Get all active session IDs.
   */
  getSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Get total line count across all sessions (for debugging).
   */
  getTotalLineCount(): number {
    let count = 0;
    for (const session of this.sessions.values()) {
      count += session.lines.length;
    }
    return count;
  }

  /**
   * Clear all sessions.
   */
  clear(): void {
    this.sessions.clear();
  }
}

// Singleton instance
export const jsonlStore = new JsonlStore();
