/**
 * Persister utilities for TinyBase + SQLite.
 * Main persistence logic is in provider.tsx.
 * This file contains utility functions for direct database access.
 */

import type * as SQLite from 'expo-sqlite';
import type { Persister } from 'tinybase/persisters';
import { Mutex } from 'async-mutex';

/**
 * Direct database reference for manual queries.
 * Set by StoreProvider during initialization.
 */
let dbInstance: SQLite.SQLiteDatabase | null = null;

/**
 * TinyBase persister instance for coordinating auto-save with transactions.
 * Set by StoreProvider during initialization.
 */
let persisterInstance: Persister | null = null;

/**
 * Transaction mutex to prevent nested transactions.
 * expo-sqlite's withTransactionAsync doesn't support nesting, so we serialize
 * all transaction requests to ensure only one runs at a time.
 */
const transactionMutex = new Mutex();

export function setDbInstance(db: SQLite.SQLiteDatabase | null): void {
  dbInstance = db;
}

export function getDbInstance(): SQLite.SQLiteDatabase | null {
  return dbInstance;
}

export function setPersisterInstance(p: Persister | null): void {
  persisterInstance = p;
}

export function getPersisterInstance(): Persister | null {
  return persisterInstance;
}

/**
 * Execute a raw SQL query on the database.
 * Use for queries that bypass TinyBase (e.g., loading closed session messages).
 */
export async function executeQuery<T>(
  sql: string,
  params: (string | number | null)[] = []
): Promise<T[]> {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  return dbInstance.getAllAsync<T>(sql, params);
}

/**
 * Execute a raw SQL statement (INSERT, UPDATE, DELETE).
 */
export async function executeStatement(
  sql: string,
  params: (string | number | null)[] = []
): Promise<SQLite.SQLiteRunResult> {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }
  return dbInstance.runAsync(sql, params);
}

/**
 * Execute multiple statements in a transaction.
 * Uses a mutex to serialize transactions and prevent nesting errors.
 * Also pauses TinyBase auto-save during the transaction to prevent conflicts.
 */
export async function withTransaction(fn: () => Promise<void>): Promise<void> {
  if (!dbInstance) {
    throw new Error('Database not initialized');
  }

  await transactionMutex.runExclusive(async () => {
    // Pause TinyBase auto-save to prevent transaction conflicts
    const wasAutoSaving = persisterInstance?.isAutoSaving() ?? false;
    if (wasAutoSaving) {
      await persisterInstance?.stopAutoSave();
    }

    try {
      await dbInstance!.withTransactionAsync(fn);
    } finally {
      if (wasAutoSaving) {
        await persisterInstance?.startAutoSave();
      }
    }
  });
}
