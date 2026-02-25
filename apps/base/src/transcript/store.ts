/**
 * In-memory store for JSONL transcript lines per session.
 *
 * Only keeps lines for open/active sessions to cap memory usage.
 */

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
  name: string | null; // Session name from custom-title JSONL lines
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
      name: null,
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

    // Filter lines with timestamp > lastMessageTs.
    // Lines without timestamps (e.g. custom-title) are always included.
    return session.lines.filter(
      (line) => !line.timestamp || line.timestamp > lastMessageTs,
    );
  }

  /**
   * Get session name.
   */
  getName(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.name ?? null;
  }

  /**
   * Set session name.
   */
  setName(sessionId: string, name: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.name = name;
    }
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
