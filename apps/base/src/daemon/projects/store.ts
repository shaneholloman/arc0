import { readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { watch, type FSWatcher } from "chokidar";
import type { SocketProjectData } from "@arc0/types";

const CLAUDE_PROJECTS_PATH = join(homedir(), ".claude", "projects");

/**
 * Extracts the cwd from the first JSONL line that contains it.
 * Returns null if no cwd found.
 */
async function extractCwdFromJsonl(filePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    rl.on("line", (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed.cwd) {
          rl.close();
          stream.destroy();
          resolve(parsed.cwd);
        }
      } catch {
        // Skip invalid JSON lines
      }
    });

    rl.on("close", () => {
      stream.destroy();
      resolve(null);
    });
    rl.on("error", () => {
      stream.destroy();
      resolve(null);
    });
  });
}

/**
 * Loads a project from an encoded directory name.
 * Scans the directory for JSONL files and extracts cwd.
 */
async function loadProject(encodedDir: string): Promise<SocketProjectData | null> {
  const dirPath = join(CLAUDE_PROJECTS_PATH, encodedDir);

  try {
    const files = await readdir(dirPath);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    if (jsonlFiles.length === 0) return null;

    // Try to extract cwd from the first JSONL file
    const cwd = await extractCwdFromJsonl(join(dirPath, jsonlFiles[0]!));
    if (!cwd) return null;

    return { cwd };
  } catch {
    return null;
  }
}

/**
 * ProjectStore - manages known projects from ~/.claude/projects/
 *
 * Scans on startup and watches for new project directories.
 * Projects are append-only (no deletion handling).
 */
export class ProjectStore {
  private projects = new Map<string, SocketProjectData>();
  private watcher: FSWatcher | null = null;
  private isRunning = false;

  async start(): Promise<void> {
    if (this.isRunning) return;

    // Scan all existing projects
    try {
      const dirs = await readdir(CLAUDE_PROJECTS_PATH);
      const results = await Promise.all(dirs.map((d) => loadProject(d)));

      for (const project of results) {
        if (project) {
          this.projects.set(project.cwd, project);
        }
      }

      console.log(`[projects] Loaded ${this.projects.size} projects`);
    } catch (err) {
      console.error(`[projects] Failed to scan projects:`, err);
    }

    // Watch for new JSONL files (indicates new projects)
    this.watcher = watch(join(CLAUDE_PROJECTS_PATH, "**/*.jsonl"), {
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    this.watcher.on("add", async (filePath) => {
      const encodedDir = basename(dirname(filePath));
      if (!encodedDir) return;

      const project = await loadProject(encodedDir);
      if (project && !this.projects.has(project.cwd)) {
        this.projects.set(project.cwd, project);
        console.log(`[projects] Added project: ${project.cwd}`);
      }
    });

    this.isRunning = true;
    console.log(`[projects] Watching: ${CLAUDE_PROJECTS_PATH}`);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    this.isRunning = false;
  }

  getAll(): SocketProjectData[] {
    return Array.from(this.projects.values());
  }

  get running(): boolean {
    return this.isRunning;
  }
}

export const projectStore = new ProjectStore();
