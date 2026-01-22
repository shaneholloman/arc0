/**
 * Check if running as a compiled binary (not via node/bun/tsx).
 * When Bun compiles a binary, process.execPath points to the binary itself,
 * not to a node/bun executable.
 */
export function isCompiledBinary(): boolean {
  const execPath = process.execPath.toLowerCase();
  return !execPath.includes("node") && !execPath.includes("bun") && !execPath.includes("tsx");
}
