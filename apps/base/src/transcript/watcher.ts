/**
 * JSONL file watcher.
 * Watches session JSONL files and emits events when new lines are added.
 */

import { watch, type FSWatcher } from "chokidar";
import { existsSync } from "node:fs";
import { dirname, isAbsolute, relative } from "node:path";
import { eventBus } from "../lib/events.js";
import { readJsonlFile, readJsonlFileFrom } from "./reader.js";
import { jsonlStore, type StoredLine } from "./store.js";

interface PendingSessionWatch {
  sessionId: string;
  filePath: string;
  discoveryRoot: string;
}

interface DiscoveryWatcherEntry {
  watcher: FSWatcher;
  sessionIds: Set<string>;
}

/**
 * NOTE:
 * Chokidar can enter a stuck state if asked to watch a file path whose parent
 * directory does not exist yet. In that case, later creation of parent/file may
 * not emit the expected add/change events for that file watch.
 *
 * References:
 * - https://github.com/paulmillr/chokidar/issues/1422
 * - https://github.com/paulmillr/chokidar/issues/346
 *
 * Workaround used here:
 * - queue pending file watches
 * - watch nearest existing ancestor directory for discovery
 * - attach direct file watcher only after parent path materializes
 */
/**
 * Manages watching multiple JSONL files.
 * One watcher per session file.
 */
class JsonlWatcher {
  private watchers = new Map<string, FSWatcher>();
  private pendingSessions = new Map<string, PendingSessionWatch>();
  private discoveryWatchers = new Map<string, DiscoveryWatcherEntry>();

  /**
   * Start watching a session's JSONL file.
   * Works even if file doesn't exist yet - will detect creation.
   */
  watchSession(sessionId: string, filePath: string): void {
    // Already watching
    if (this.watchers.has(sessionId)) {
      return;
    }

    const pending = this.pendingSessions.get(sessionId);
    if (pending?.filePath === filePath) {
      return;
    }

    // Initialize session in store (file may not exist yet)
    jsonlStore.addSession(sessionId, filePath, []);

    this.tryAttachWatcher(sessionId, filePath);
  }

  /**
   * Try to attach the direct file watcher for a session.
   * If parent directory does not exist yet, session is tracked as pending and
   * a discovery watcher is attached to the closest existing ancestor.
   */
  private tryAttachWatcher(sessionId: string, filePath: string): void {
    if (this.watchers.has(sessionId) || !jsonlStore.hasSession(sessionId)) {
      return;
    }

    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      this.queuePendingSession(sessionId, filePath);
      return;
    }

    // Set up file watcher - chokidar handles non-existent file paths
    // as long as the parent directory exists.
    let watcher: FSWatcher;
    try {
      watcher = watch(filePath, {
        persistent: true,
        // Don't error on non-existent paths
        ignoreInitial: false,
        awaitWriteFinish: {
          stabilityThreshold: 100,
          pollInterval: 50,
        },
      });
    } catch (error) {
      console.error(
        `[jsonl/watcher] Failed to watch file for session ${sessionId}:`,
        error,
      );
      return;
    }

    // File created - do initial read
    watcher.on("add", () => this.handleFileAdd(sessionId, filePath));

    // File modified - read new lines
    watcher.on("change", () => this.handleFileChange(sessionId, filePath));

    watcher.on("error", (error) => {
      console.error(
        `[jsonl/watcher] File watcher error for session ${sessionId}:`,
        error,
      );
    });

    this.watchers.set(sessionId, watcher);
    this.removePendingSession(sessionId);
    console.log(`[jsonl/watcher] Watching: ${filePath}`);
  }

  /**
   * Queue session until transcript parent path exists.
   */
  private queuePendingSession(sessionId: string, filePath: string): void {
    const discoveryRoot = this.findNearestExistingAncestor(filePath);
    const existing = this.pendingSessions.get(sessionId);

    if (
      existing &&
      existing.filePath === filePath &&
      existing.discoveryRoot === discoveryRoot
    ) {
      return;
    }

    this.removePendingSession(sessionId);

    const entry: PendingSessionWatch = { sessionId, filePath, discoveryRoot };
    this.pendingSessions.set(sessionId, entry);

    this.ensureDiscoveryWatcher(discoveryRoot);
    this.discoveryWatchers.get(discoveryRoot)?.sessionIds.add(sessionId);

    console.log(
      `[jsonl/watcher] Parent missing for session ${sessionId}, waiting via ancestor ${discoveryRoot}`,
    );
  }

  /**
   * Ensure a shared discovery watcher exists for an ancestor directory.
   */
  private ensureDiscoveryWatcher(discoveryRoot: string): void {
    if (this.discoveryWatchers.has(discoveryRoot)) {
      return;
    }

    const watcher = watch(discoveryRoot, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    watcher.on("add", (path) => this.handleDiscoveryEvent(discoveryRoot, path));
    watcher.on("addDir", (path) =>
      this.handleDiscoveryEvent(discoveryRoot, path),
    );
    watcher.on("change", (path) =>
      this.handleDiscoveryEvent(discoveryRoot, path),
    );

    // Re-check pending sessions once the watcher is ready, closing the race
    // window between the existsSync check and chokidar being fully online.
    watcher.on("ready", () => {
      const discovery = this.discoveryWatchers.get(discoveryRoot);
      if (!discovery) return;
      for (const sessionId of Array.from(discovery.sessionIds)) {
        const pending = this.pendingSessions.get(sessionId);
        if (!pending || pending.discoveryRoot !== discoveryRoot) continue;
        this.tryAttachWatcher(sessionId, pending.filePath);
      }
    });

    watcher.on("error", (error) => {
      console.error(
        `[jsonl/discovery] Discovery watcher error for ${discoveryRoot}:`,
        error,
      );
    });

    this.discoveryWatchers.set(discoveryRoot, {
      watcher,
      sessionIds: new Set(),
    });

    console.log(`[jsonl/discovery] Watching ancestor: ${discoveryRoot}`);
  }

  /**
   * Handle discovery events and attach direct file watchers when possible.
   */
  private handleDiscoveryEvent(
    discoveryRoot: string,
    changedPath: string,
  ): void {
    const discovery = this.discoveryWatchers.get(discoveryRoot);
    if (!discovery) {
      return;
    }

    for (const sessionId of Array.from(discovery.sessionIds)) {
      const pending = this.pendingSessions.get(sessionId);
      if (!pending || pending.discoveryRoot !== discoveryRoot) {
        continue;
      }

      if (!this.isAncestorPath(changedPath, pending.filePath)) {
        continue;
      }

      this.tryAttachWatcher(sessionId, pending.filePath);
    }
  }

  /**
   * Remove pending session state and release discovery watcher subscriptions.
   */
  private removePendingSession(sessionId: string): void {
    const pending = this.pendingSessions.get(sessionId);
    if (!pending) {
      return;
    }

    this.pendingSessions.delete(sessionId);

    const discovery = this.discoveryWatchers.get(pending.discoveryRoot);
    if (!discovery) {
      return;
    }

    discovery.sessionIds.delete(sessionId);
    if (discovery.sessionIds.size > 0) {
      return;
    }

    discovery.watcher.close();
    this.discoveryWatchers.delete(pending.discoveryRoot);
    console.log(
      `[jsonl/discovery] Stopped ancestor watcher: ${pending.discoveryRoot}`,
    );
  }

  /**
   * Find the closest existing ancestor directory for a path.
   */
  private findNearestExistingAncestor(path: string): string {
    let candidate = dirname(path);
    while (!existsSync(candidate)) {
      const parent = dirname(candidate);
      if (parent === candidate) {
        return candidate;
      }
      candidate = parent;
    }
    return candidate;
  }

  /**
   * True when ancestorPath is the same path or an ancestor of targetPath.
   */
  private isAncestorPath(ancestorPath: string, targetPath: string): boolean {
    const relPath = relative(ancestorPath, targetPath);
    return (
      relPath === "" || (!relPath.startsWith("..") && !isAbsolute(relPath))
    );
  }

  /**
   * Handle file creation - read initial content.
   */
  private handleFileAdd(sessionId: string, filePath: string): void {
    const { lines, position } = readJsonlFile(filePath);

    // Replace empty initial lines with actual content
    jsonlStore.addSession(sessionId, filePath, lines);
    jsonlStore.updateFilePosition(sessionId, position);

    console.log(
      `[jsonl/watcher] Loaded ${lines.length} lines for session ${sessionId}`,
    );

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

    this.removePendingSession(sessionId);

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

    console.log(
      `[jsonl/watcher] ${lines.length} new lines for session ${sessionId}`,
    );

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

    for (const sessionId of this.pendingSessions.keys()) {
      jsonlStore.removeSession(sessionId);
    }

    for (const discovery of this.discoveryWatchers.values()) {
      discovery.watcher.close();
    }

    this.watchers.clear();
    this.pendingSessions.clear();
    this.discoveryWatchers.clear();
    console.log("[jsonl/watcher] Stopped all watchers");
  }
}

// Singleton instance
export const jsonlWatcher = new JsonlWatcher();
