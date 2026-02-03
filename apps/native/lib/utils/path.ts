/**
 * Path display utilities.
 */

/**
 * Common user directory patterns to strip from paths.
 * These are removed to show more relevant parts of the path.
 */
const USER_DIR_PATTERNS = [
  /^\/Users\/[^/]+\//, // macOS: /Users/<username>/
  /^\/home\/[^/]+\//, // Linux: /home/<username>/
  /^C:\\Users\\[^\\]+\\/i, // Windows: C:\Users\<username>\
  /^~\//, // Home shortcut: ~/
];

/**
 * Strip user directory prefix from a path.
 * Removes common user directory patterns to show more relevant parts.
 *
 * @example
 * stripUserDir('/Users/john/projects/my-app')
 * // Returns: 'projects/my-app'
 */
function stripUserDir(path: string): string {
  for (const pattern of USER_DIR_PATTERNS) {
    if (pattern.test(path)) {
      return path.replace(pattern, '');
    }
  }
  return path;
}

/**
 * Get the last N segments of a path.
 *
 * @example
 * getLastSegments('a/b/c/d/e', 3)
 * // Returns: 'c/d/e'
 */
function getLastSegments(path: string, count: number): string {
  const segments = path.split('/').filter(Boolean);
  if (segments.length <= count) {
    return segments.join('/');
  }
  return segments.slice(-count).join('/');
}

/**
 * Smart path truncation for display.
 *
 * Logic:
 * 1. Strip user directory prefix (/Users/<username>/, /home/<username>/, etc.)
 * 2. Take last 3 path segments (typically org/repo structure)
 * 3. Apply character truncation if still too long (ellipsis at start)
 *
 * @param path - The full path to truncate
 * @param maxLength - Maximum length before truncation (default 30)
 * @returns Truncated path optimized for display
 *
 * @example
 * truncatePath('/Users/john/go/src/github.com/acme/my-app', 20)
 * // Returns: '…/acme/my-app' (stripped user dir, last 3 segments, truncated)
 *
 * truncatePath('/Users/john/projects/app', 30)
 * // Returns: 'projects/app' (stripped user dir, fits within limit)
 */
export function truncatePath(path: string, maxLength: number = 30): string {
  if (!path) return '';

  // Step 1: Strip user directory prefix
  let cleaned = stripUserDir(path);

  // Step 2: Get last 3 segments (typically: github.com/org/repo or similar)
  cleaned = getLastSegments(cleaned, 3);

  // Step 3: If still too long, truncate with ellipsis at start
  if (cleaned.length <= maxLength) {
    return cleaned;
  }

  // Leave room for ellipsis (…)
  const availableLength = maxLength - 1;

  // Take from the end
  const truncated = cleaned.slice(-availableLength);

  // Try to start at a path separator for cleaner display
  const separatorIndex = truncated.indexOf('/');
  if (separatorIndex > 0 && separatorIndex < truncated.length - 1) {
    return '…' + truncated.slice(separatorIndex);
  }

  return '…' + truncated;
}

/**
 * Get the folder name from a path.
 * Returns the last segment of the path.
 *
 * @param path - The full path
 * @returns The folder name (last segment)
 *
 * @example
 * getFolderName('/Users/john/projects/my-app')
 * // Returns: 'my-app'
 */
export function getFolderName(path: string): string {
  if (!path) return '';
  return path.split('/').pop() ?? path;
}
