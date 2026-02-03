/**
 * Artifact loading and unloading for session artifacts.
 * Loads artifacts from SQLite into TinyBase on demand.
 * Follows the closed-sessions.ts pattern for load/unload.
 */

import type { Indexes, Store } from 'tinybase';
import type { ExtractedArtifact } from '../socket/artifact-extractor';
import { executeQuery, executeStatement, withTransaction } from './persister';

// =============================================================================
// Types
// =============================================================================

/**
 * Artifact row from SQLite query.
 */
interface ArtifactRow {
  id: string;
  session_id: string;
  type: string;
  provider: string;
  content: string;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Load/Unload Functions
// =============================================================================

/**
 * Load artifacts for a session from SQLite into TinyBase.
 * Uses the artifactsBySession index for O(1) check if already loaded.
 *
 * @param store - TinyBase store instance
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to load artifacts for
 * @returns true if artifacts were loaded, false if already present or none found
 */
export async function loadSessionArtifacts(
  store: Store,
  indexes: Indexes,
  sessionId: string
): Promise<boolean> {
  // Check if already loaded using index
  const artifactIds = indexes.getSliceRowIds('artifactsBySession', sessionId);
  if (artifactIds.length > 0) {
    return false;
  }

  // Query SQLite for artifacts
  const artifacts = await executeQuery<ArtifactRow>(
    'SELECT id, session_id, type, provider, content, source_message_id, created_at, updated_at FROM artifacts WHERE session_id = ?',
    [sessionId]
  );

  if (artifacts.length === 0) {
    return false;
  }

  // Insert into TinyBase store for UI reactivity
  store.transaction(() => {
    for (const artifact of artifacts) {
      store.setRow('artifacts', artifact.id, {
        session_id: artifact.session_id,
        type: artifact.type,
        provider: artifact.provider,
        content: artifact.content,
        source_message_id: artifact.source_message_id ?? '',
        created_at: artifact.created_at,
        updated_at: artifact.updated_at,
      });
    }
  });

  console.log('[artifacts-loader] Loaded artifacts for session:', {
    sessionId,
    artifactCount: artifacts.length,
    types: artifacts.map((a) => a.type),
  });

  return true;
}

/**
 * Unload artifacts from TinyBase store for a session.
 * Use this to free memory when navigating away.
 *
 * @param store - TinyBase store instance
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to unload artifacts for
 */
export function unloadSessionArtifacts(store: Store, indexes: Indexes, sessionId: string): void {
  const artifactIds = indexes.getSliceRowIds('artifactsBySession', sessionId);

  if (artifactIds.length === 0) {
    return;
  }

  store.transaction(() => {
    for (const artifactId of artifactIds) {
      store.delRow('artifacts', artifactId);
    }
  });

  console.log('[artifacts-loader] Unloaded artifacts for session:', {
    sessionId,
    artifactCount: artifactIds.length,
  });
}

/**
 * Check if artifacts for a session are loaded in the store.
 *
 * @param indexes - TinyBase indexes instance
 * @param sessionId - Session ID to check
 * @returns true if artifacts are already loaded
 */
export function areArtifactsLoaded(indexes: Indexes, sessionId: string): boolean {
  const artifactIds = indexes.getSliceRowIds('artifactsBySession', sessionId);
  return artifactIds.length > 0;
}

// =============================================================================
// Store Update Functions (for real-time socket updates)
// =============================================================================

/**
 * Upsert an artifact directly to TinyBase store.
 * Used when receiving new artifacts via Socket.IO while viewing the session.
 *
 * @param store - TinyBase store instance
 * @param artifact - Artifact to upsert
 */
export function upsertArtifactToStore(store: Store, artifact: ExtractedArtifact): void {
  store.setRow('artifacts', artifact.id, {
    session_id: artifact.sessionId,
    type: artifact.type,
    provider: artifact.provider,
    content: artifact.content,
    source_message_id: artifact.sourceMessageId,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
}

// =============================================================================
// SQLite Write Functions
// =============================================================================

/**
 * Write artifacts to SQLite database.
 * Uses INSERT ... ON CONFLICT for upsert behavior.
 *
 * @param artifacts - Artifacts to write
 */
export async function writeArtifactsToSQLite(artifacts: ExtractedArtifact[]): Promise<void> {
  if (artifacts.length === 0) return;

  await withTransaction(async () => {
    for (const artifact of artifacts) {
      await executeStatement(
        `INSERT INTO artifacts (id, session_id, type, provider, content, source_message_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           source_message_id = excluded.source_message_id,
           updated_at = datetime('now')`,
        [
          artifact.id,
          artifact.sessionId,
          artifact.type,
          artifact.provider,
          artifact.content,
          artifact.sourceMessageId,
        ]
      );
    }
  });
}
