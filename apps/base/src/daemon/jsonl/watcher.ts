/**
 * JSONL file watcher.
 * Watches session JSONL files and emits events when new lines are added.
 */

import { watch, type FSWatcher } from "chokidar";
import { eventBus } from "../../shared/events.js";
import { readJsonlFile, readJsonlFileFrom } from "./reader.js";
import { jsonlStore, type StoredLine } from "./store.js";

/**
 * Manages watching multiple JSONL files.
 * One watcher per session file.
 */
class JsonlWatcher {
  private watchers = new Map<string, FSWatcher>();

  /**
   * Start watching a session's JSONL file.
   * Works even if file doesn't exist yet - will detect creation.
   */
  watchSession(sessionId: string, filePath: string): void {
    // Already watching
    if (this.watchers.has(sessionId)) {
      return;
    }

    // Initialize session in store (file may not exist yet)
    jsonlStore.addSession(sessionId, filePath, []);

    // Set up file watcher - chokidar handles non-existent paths
    const watcher = watch(filePath, {
      persistent: true,
      // Don't error on non-existent paths
      ignoreInitial: false,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    // File created - do initial read
    watcher.on("add", () => this.handleFileAdd(sessionId, filePath));

    // File modified - read new lines
    watcher.on("change", () => this.handleFileChange(sessionId, filePath));

    this.watchers.set(sessionId, watcher);
    console.log(`[jsonl/watcher] Watching: ${filePath}`);
  }

  /**
   * Handle file creation - read initial content.
   */
  private handleFileAdd(sessionId: string, filePath: string): void {
    const { lines, position } = readJsonlFile(filePath);

    // Replace empty initial lines with actual content
    jsonlStore.addSession(sessionId, filePath, lines);
    jsonlStore.updateFilePosition(sessionId, position);

    console.log(`[jsonl/watcher] Loaded ${lines.length} lines for session ${sessionId}`);

    // Emit if there are lines to broadcast
    if (lines.length > 0) {
      eventBus.emit("messages:new", sessionId, lines);
    }
  }

  /**
   * Stop watching a session's JSONL file.
   */
  unwatchSession(sessionId: string): void {
    const watcher = this.watchers.get(sessionId);
    if (watcher) {
      watcher.close();
      this.watchers.delete(sessionId);
    }
    jsonlStore.removeSession(sessionId);
    console.log(`[jsonl/watcher] Stopped watching session ${sessionId}`);
  }

  /**
   * Handle file change - read new lines and emit event.
   */
  private handleFileChange(sessionId: string, filePath: string): void {
    const currentPosition = jsonlStore.getFilePosition(sessionId);
    const { lines, position } = readJsonlFileFrom(filePath, currentPosition);

    if (lines.length === 0) {
      return;
    }

    // Update store
    jsonlStore.appendLines(sessionId, lines);
    jsonlStore.updateFilePosition(sessionId, position);

    console.log(`[jsonl/watcher] ${lines.length} new lines for session ${sessionId}`);

    // Emit event for daemon to broadcast
    eventBus.emit("messages:new", sessionId, lines);
  }

  /**
   * Get lines for a session since a timestamp.
   * Used for initial sync on client connect.
   */
  getLinesSince(sessionId: string, lastMessageTs: string): StoredLine[] {
    return jsonlStore.getLinesSince(sessionId, lastMessageTs);
  }

  /**
   * Get all lines for a session.
   */
  getAllLines(sessionId: string): StoredLine[] {
    return jsonlStore.getAllLines(sessionId);
  }

  /**
   * Check if session is being watched.
   */
  isWatching(sessionId: string): boolean {
    return this.watchers.has(sessionId);
  }

  /**
   * Get all watched session IDs.
   */
  getWatchedSessions(): string[] {
    return Array.from(this.watchers.keys());
  }

  /**
   * Stop all watchers.
   */
  stopAll(): void {
    for (const [sessionId, watcher] of this.watchers) {
      watcher.close();
      jsonlStore.removeSession(sessionId);
    }
    this.watchers.clear();
    console.log("[jsonl/watcher] Stopped all watchers");
  }
}

// Singleton instance
export const jsonlWatcher = new JsonlWatcher();
