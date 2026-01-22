/**
 * Stub watcher for Codex CLI.
 * TODO: Implement when Codex session data location is known.
 */
export class CodexWatcher {
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[codex] Watcher started (stub)");
  }

  stop(): void {
    this.isRunning = false;
  }

  get running(): boolean {
    return this.isRunning;
  }
}
