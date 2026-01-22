import { watch, type FSWatcher } from "chokidar";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Watches Claude Code JSONL session files.
 * TODO: Parse JSONL and emit message events via eventBus.
 */
export class ClaudeWatcher {
  private watcher: FSWatcher | null = null;
  private watchPath: string;
  private isRunning = false;

  constructor(watchPath?: string) {
    // Default Claude Code sessions path
    this.watchPath = watchPath ?? join(homedir(), ".claude", "projects");
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.watcher = watch(this.watchPath, {
      persistent: true,
      ignoreInitial: true,
      depth: 3,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 100,
      },
    });

    this.watcher.on("change", (path) => this.handleFileChange(path));

    this.isRunning = true;
    console.log(`[claude] Watching: ${this.watchPath}`);
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

  private handleFileChange(filePath: string): void {
    // Only watch .jsonl files (session logs)
    if (!filePath.endsWith(".jsonl")) return;

    // TODO: Parse new lines from JSONL and emit via eventBus
    // eventBus.emit("message:new", message, sessionId);
  }
}
