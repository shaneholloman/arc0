/**
 * Workstation secret storage for multi-workstation support.
 * Platform-aware: uses expo-secure-store on native, OPFS on web.
 *
 * Secrets are stored separately from workstation config (SQLite) for security.
 * Key format: arc0_ws_secret_{workstationId}
 */

import { Platform } from 'react-native';

// =============================================================================
// Types
// =============================================================================

export interface WorkstationConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  active: boolean;
}

// =============================================================================
// Storage Keys
// =============================================================================

const SECRET_KEY_PREFIX = 'arc0_ws_secret_';
const ENCKEY_KEY_PREFIX = 'arc0_ws_enckey_';
const WEB_OPFS_FILENAME = 'workstation-secrets.json';

function getSecretKey(workstationId: string): string {
  return `${SECRET_KEY_PREFIX}${workstationId}`;
}

function getEncryptionKeyKey(workstationId: string): string {
  return `${ENCKEY_KEY_PREFIX}${workstationId}`;
}

// =============================================================================
// Native Storage (expo-secure-store)
// =============================================================================

async function getNativeSecret(workstationId: string): Promise<string | null> {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(getSecretKey(workstationId));
}

async function setNativeSecret(workstationId: string, secret: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(getSecretKey(workstationId), secret);
}

async function deleteNativeSecret(workstationId: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(getSecretKey(workstationId));
}

async function getNativeEncryptionKey(workstationId: string): Promise<string | null> {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(getEncryptionKeyKey(workstationId));
}

async function setNativeEncryptionKey(workstationId: string, key: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(getEncryptionKeyKey(workstationId), key);
}

async function deleteNativeEncryptionKey(workstationId: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(getEncryptionKeyKey(workstationId));
}

// =============================================================================
// Web Storage (OPFS)
// =============================================================================

// WebSecretsStore supports both legacy format (string = secret only) and new format (object)
interface WorkstationSecrets {
  secret?: string;
  encryptionKey?: string;
}

interface WebSecretsStore {
  [workstationId: string]: string | WorkstationSecrets;
}

const WEB_SECRETS_KEY_DB = 'arc0_web_secrets';
const WEB_SECRETS_KEY_STORE = 'keys';
const WEB_SECRETS_KEY_ID = 'workstation-secrets';

interface EncryptedWebSecrets {
  v: 1;
  iv: string;
  data: string;
}

function isEncryptedPayload(value: unknown): value is EncryptedWebSecrets {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as { v?: unknown; iv?: unknown; data?: unknown };
  return payload.v === 1 && typeof payload.iv === 'string' && typeof payload.data === 'string';
}

/**
 * Normalize a stored value to WorkstationSecrets object.
 * Handles backward compatibility with old string-only format.
 */
function normalizeSecrets(value: string | WorkstationSecrets | undefined): WorkstationSecrets {
  if (!value) {
    return {};
  }
  if (typeof value === 'string') {
    // Legacy format: just the secret string
    return { secret: value };
  }
  return value;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function openWebSecretsKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_SECRETS_KEY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WEB_SECRETS_KEY_STORE)) {
        db.createObjectStore(WEB_SECRETS_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWebCryptoKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WEB_SECRETS_KEY_STORE, 'readonly');
    const store = transaction.objectStore(WEB_SECRETS_KEY_STORE);
    const request = store.get(WEB_SECRETS_KEY_ID);
    request.onsuccess = () => resolve((request.result as CryptoKey) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeWebCryptoKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WEB_SECRETS_KEY_STORE, 'readwrite');
    const store = transaction.objectStore(WEB_SECRETS_KEY_STORE);
    const request = store.put(key, WEB_SECRETS_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getWebCryptoKey(): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto unavailable');
  }
  const db = await openWebSecretsKeyDb();
  try {
    const existing = await readWebCryptoKey(db);
    if (existing) {
      return existing;
    }
    const key = await globalThis.crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
    await writeWebCryptoKey(db, key);
    return key;
  } finally {
    db.close();
  }
}

async function encryptWebSecrets(secrets: WebSecretsStore): Promise<EncryptedWebSecrets> {
  const key = await getWebCryptoKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(secrets));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  return {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(ciphertext),
  };
}

async function decryptWebSecrets(payload: EncryptedWebSecrets): Promise<WebSecretsStore> {
  const key = await getWebCryptoKey();
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as WebSecretsStore;
}

async function getWebOpfsHandle(): Promise<FileSystemFileHandle> {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getFileHandle(WEB_OPFS_FILENAME, { create: true });
}

async function readWebSecrets(): Promise<WebSecretsStore> {
  try {
    const handle = await getWebOpfsHandle();
    const file = await handle.getFile();
    const text = await file.text();

    if (!text) {
      return {};
    }

    const parsed = JSON.parse(text) as unknown;
    if (isEncryptedPayload(parsed)) {
      return await decryptWebSecrets(parsed);
    }
    return parsed as WebSecretsStore;
  } catch {
    return {};
  }
}

async function writeWebSecrets(secrets: WebSecretsStore): Promise<void> {
  const handle = await getWebOpfsHandle();
  const writable = await handle.createWritable();
  let payload: string;
  try {
    payload = JSON.stringify(await encryptWebSecrets(secrets));
  } catch {
    payload = JSON.stringify(secrets);
  }
  await writable.write(payload);
  await writable.close();
}

async function getWebSecret(workstationId: string): Promise<string | null> {
  const secrets = await readWebSecrets();
  const normalized = normalizeSecrets(secrets[workstationId]);
  return normalized.secret ?? null;
}

async function setWebSecret(workstationId: string, secret: string): Promise<void> {
  const secrets = await readWebSecrets();
  const normalized = normalizeSecrets(secrets[workstationId]);
  normalized.secret = secret;
  secrets[workstationId] = normalized;
  await writeWebSecrets(secrets);
}

async function deleteWebSecret(workstationId: string): Promise<void> {
  const secrets = await readWebSecrets();
  const normalized = normalizeSecrets(secrets[workstationId]);
  delete normalized.secret;
  // If no secrets left, delete the entire entry
  if (!normalized.encryptionKey) {
    delete secrets[workstationId];
  } else {
    secrets[workstationId] = normalized;
  }
  await writeWebSecrets(secrets);
}

async function getWebEncryptionKey(workstationId: string): Promise<string | null> {
  const secrets = await readWebSecrets();
  const normalized = normalizeSecrets(secrets[workstationId]);
  return normalized.encryptionKey ?? null;
}

async function setWebEncryptionKey(workstationId: string, key: string): Promise<void> {
  const secrets = await readWebSecrets();
  const normalized = normalizeSecrets(secrets[workstationId]);
  normalized.encryptionKey = key;
  secrets[workstationId] = normalized;
  await writeWebSecrets(secrets);
}

async function deleteWebEncryptionKey(workstationId: string): Promise<void> {
  const secrets = await readWebSecrets();
  const normalized = normalizeSecrets(secrets[workstationId]);
  delete normalized.encryptionKey;
  // If no secrets left, delete the entire entry
  if (!normalized.secret) {
    delete secrets[workstationId];
  } else {
    secrets[workstationId] = normalized;
  }
  await writeWebSecrets(secrets);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the secret for a specific workstation.
 * Returns null if not found.
 */
export async function getWorkstationSecret(workstationId: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return getWebSecret(workstationId);
  }
  return getNativeSecret(workstationId);
}

/**
 * Set the secret for a specific workstation.
 */
export async function setWorkstationSecret(workstationId: string, secret: string): Promise<void> {
  if (Platform.OS === 'web') {
    return setWebSecret(workstationId, secret);
  }
  return setNativeSecret(workstationId, secret);
}

/**
 * Delete the secret for a specific workstation.
 */
export async function deleteWorkstationSecret(workstationId: string): Promise<void> {
  if (Platform.OS === 'web') {
    return deleteWebSecret(workstationId);
  }
  return deleteNativeSecret(workstationId);
}

/**
 * Get the encryption key for a specific workstation.
 * Returns null if not found.
 */
export async function getWorkstationEncryptionKey(workstationId: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return getWebEncryptionKey(workstationId);
  }
  return getNativeEncryptionKey(workstationId);
}

/**
 * Set the encryption key for a specific workstation.
 */
export async function setWorkstationEncryptionKey(
  workstationId: string,
  key: string
): Promise<void> {
  if (Platform.OS === 'web') {
    return setWebEncryptionKey(workstationId, key);
  }
  return setNativeEncryptionKey(workstationId, key);
}

/**
 * Delete the encryption key for a specific workstation.
 */
export async function deleteWorkstationEncryptionKey(workstationId: string): Promise<void> {
  if (Platform.OS === 'web') {
    return deleteWebEncryptionKey(workstationId);
  }
  return deleteNativeEncryptionKey(workstationId);
}

/**
 * Get all workstation secrets (for migration purposes).
 * Web: returns all secrets from OPFS
 * Native: not supported (returns empty object)
 */
export async function getAllWorkstationSecrets(): Promise<WebSecretsStore> {
  if (Platform.OS === 'web') {
    return readWebSecrets();
  }
  // Native doesn't support listing all keys efficiently
  return {};
}

/**
 * Clear all workstation secrets and encryption keys.
 */
export async function clearAllWorkstationSecrets(workstationIds?: string[]): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      const opfs = await navigator.storage.getDirectory();
      await opfs.removeEntry(WEB_OPFS_FILENAME);
    } catch {
      // File may not exist, ignore
    }
    return;
  }

  if (!workstationIds || workstationIds.length === 0) {
    // Native: we need workstation IDs to clear SecureStore entries
    console.warn('[workstations] clearAllWorkstationSecrets needs workstation IDs on native');
    return;
  }

  for (const workstationId of workstationIds) {
    try {
      await deleteNativeSecret(workstationId);
      await deleteNativeEncryptionKey(workstationId);
    } catch (err) {
      console.warn(`[workstations] Failed to clear secrets for workstation ${workstationId}:`, err);
    }
  }
}

/**
 * Generate a unique workstation ID.
 */
export function generateWorkstationId(): string {
  // Use crypto.randomUUID if available (modern browsers, React Native 0.70+)
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: generate UUID-like string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
