/**
 * Stub watcher for Gemini CLI.
 * TODO: Implement when Gemini CLI session data location is known.
 */
export class GeminiWatcher {
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log("[gemini] Watcher started (stub)");
  }

  stop(): void {
    this.isRunning = false;
  }

  get running(): boolean {
    return this.isRunning;
  }
}
