import { watch, type FSWatcher } from "chokidar";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { basename } from "node:path";
import { SESSIONS_DIR } from "../../shared/config.js";
import { eventBus } from "../../shared/events.js";
import type { SessionFile } from "../../shared/types.js";

/**
 * Watches ~/.arc0/sessions/ for session files created by hooks.
 * This is provider-agnostic - all providers write to the same directory.
 */
export class SessionFileWatcher {
  private watcher: FSWatcher | null = null;
  private activeSessions = new Map<string, SessionFile>();
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Ensure sessions directory exists
    if (!existsSync(SESSIONS_DIR)) {
      mkdirSync(SESSIONS_DIR, { recursive: true });
    }

    this.watcher = watch(SESSIONS_DIR, {
      persistent: true,
      ignoreInitial: false,
      depth: 0,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 50,
      },
    });

    this.watcher.on("add", (path) => this.handleAdd(path));
    this.watcher.on("change", (path) => this.handleChange(path));
    this.watcher.on("unlink", (path) => this.handleRemove(path));

    this.isRunning = true;
    console.log(`[sessions] Watching: ${SESSIONS_DIR}`);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.isRunning = false;
  }

  get running(): boolean {
    return this.isRunning;
  }

  private readSessionFile(filePath: string): SessionFile | null {
    try {
      const content = readFileSync(filePath, "utf-8");
      return JSON.parse(content) as SessionFile;
    } catch {
      return null;
    }
  }

  private getSessionIdFromPath(filePath: string): string | null {
    const filename = basename(filePath);
    if (!filename.endsWith(".json")) return null;
    return filename.replace(".json", "");
  }

  private emitSessionsChange(): void {
    eventBus.emit("sessions:change", this.getActiveSessions());
  }

  private handleAdd(filePath: string): void {
    const sessionId = this.getSessionIdFromPath(filePath);
    if (!sessionId) return;

    const session = this.readSessionFile(filePath);
    if (!session) return;

    this.activeSessions.set(sessionId, session);

    eventBus.emit("session:start", session);
    this.emitSessionsChange();
  }

  private handleChange(filePath: string): void {
    const sessionId = this.getSessionIdFromPath(filePath);
    if (!sessionId) return;

    const session = this.readSessionFile(filePath);
    if (!session) return;

    this.activeSessions.set(sessionId, session);

    eventBus.emit("session:update", session);
    this.emitSessionsChange();
  }

  private handleRemove(filePath: string): void {
    const sessionId = this.getSessionIdFromPath(filePath);
    if (!sessionId) return;

    this.activeSessions.delete(sessionId);

    eventBus.emit("session:end", sessionId);
    this.emitSessionsChange();
  }

  getActiveSessions(): SessionFile[] {
    return Array.from(this.activeSessions.values());
  }
}
