/**
 * Workstation credential storage for multi-workstation support.
 * Platform-aware: uses expo-secure-store on native, OPFS on web.
 *
 * Credentials are stored separately from workstation config (SQLite) for security.
 * Key format: arc0_ws_auth_token_{workstationId}
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

const AUTH_TOKEN_KEY_PREFIX = 'arc0_ws_auth_token_';
const ENCKEY_KEY_PREFIX = 'arc0_ws_enckey_';
const WEB_OPFS_FILENAME = 'workstation-credentials.json';

function getAuthTokenKey(workstationId: string): string {
  return `${AUTH_TOKEN_KEY_PREFIX}${workstationId}`;
}

function getEncryptionKeyKey(workstationId: string): string {
  return `${ENCKEY_KEY_PREFIX}${workstationId}`;
}

// =============================================================================
// Native Storage (expo-secure-store)
// =============================================================================

async function getNativeAuthToken(workstationId: string): Promise<string | null> {
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(getAuthTokenKey(workstationId));
}

async function setNativeAuthToken(workstationId: string, authToken: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(getAuthTokenKey(workstationId), authToken);
}

async function deleteNativeAuthToken(workstationId: string): Promise<void> {
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(getAuthTokenKey(workstationId));
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

interface WorkstationCredentials {
  authToken?: string;
  encryptionKey?: string;
}

interface WebCredentialsStore {
  [workstationId: string]: WorkstationCredentials;
}

const WEB_CREDENTIALS_KEY_DB = 'arc0_web_credentials';
const WEB_CREDENTIALS_KEY_STORE = 'keys';
const WEB_CREDENTIALS_KEY_ID = 'workstation-credentials';

interface EncryptedWebCredentials {
  v: 1;
  iv: string;
  data: string;
}

function isEncryptedPayload(value: unknown): value is EncryptedWebCredentials {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const payload = value as { v?: unknown; iv?: unknown; data?: unknown };
  return payload.v === 1 && typeof payload.iv === 'string' && typeof payload.data === 'string';
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

async function openWebCredentialsKeyDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(WEB_CREDENTIALS_KEY_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(WEB_CREDENTIALS_KEY_STORE)) {
        db.createObjectStore(WEB_CREDENTIALS_KEY_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readWebCryptoKey(db: IDBDatabase): Promise<CryptoKey | null> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WEB_CREDENTIALS_KEY_STORE, 'readonly');
    const store = transaction.objectStore(WEB_CREDENTIALS_KEY_STORE);
    const request = store.get(WEB_CREDENTIALS_KEY_ID);
    request.onsuccess = () => resolve((request.result as CryptoKey) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeWebCryptoKey(db: IDBDatabase, key: CryptoKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(WEB_CREDENTIALS_KEY_STORE, 'readwrite');
    const store = transaction.objectStore(WEB_CREDENTIALS_KEY_STORE);
    const request = store.put(key, WEB_CREDENTIALS_KEY_ID);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function getWebCryptoKey(): Promise<CryptoKey> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto unavailable');
  }
  const db = await openWebCredentialsKeyDb();
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

async function encryptWebCredentials(
  credentials: WebCredentialsStore
): Promise<EncryptedWebCredentials> {
  const key = await getWebCryptoKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(credentials));
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  );
  return {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(ciphertext),
  };
}

async function decryptWebCredentials(
  payload: EncryptedWebCredentials
): Promise<WebCredentialsStore> {
  const key = await getWebCryptoKey();
  const iv = base64ToBytes(payload.iv);
  const data = base64ToBytes(payload.data);
  const plaintext = await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  const json = new TextDecoder().decode(plaintext);
  return JSON.parse(json) as WebCredentialsStore;
}

async function getWebOpfsHandle(): Promise<FileSystemFileHandle> {
  const opfs = await navigator.storage.getDirectory();
  return opfs.getFileHandle(WEB_OPFS_FILENAME, { create: true });
}

async function readWebCredentials(): Promise<WebCredentialsStore> {
  try {
    const handle = await getWebOpfsHandle();
    const file = await handle.getFile();
    const text = await file.text();

    if (!text) {
      return {};
    }

    const parsed = JSON.parse(text) as unknown;
    if (isEncryptedPayload(parsed)) {
      return await decryptWebCredentials(parsed);
    }
    return parsed as WebCredentialsStore;
  } catch {
    return {};
  }
}

async function writeWebCredentials(credentials: WebCredentialsStore): Promise<void> {
  const handle = await getWebOpfsHandle();
  const writable = await handle.createWritable();
  let payload: string;
  try {
    payload = JSON.stringify(await encryptWebCredentials(credentials));
  } catch {
    payload = JSON.stringify(credentials);
  }
  await writable.write(payload);
  await writable.close();
}

async function getWebAuthToken(workstationId: string): Promise<string | null> {
  const credentials = await readWebCredentials();
  return credentials[workstationId]?.authToken ?? null;
}

async function setWebAuthToken(workstationId: string, authToken: string): Promise<void> {
  const credentials = await readWebCredentials();
  const current = credentials[workstationId] ?? {};
  current.authToken = authToken;
  credentials[workstationId] = current;
  await writeWebCredentials(credentials);
}

async function deleteWebAuthToken(workstationId: string): Promise<void> {
  const credentials = await readWebCredentials();
  const current = credentials[workstationId];
  if (!current) {
    return;
  }
  delete current.authToken;
  // If no credentials left, delete the entire entry
  if (!current.encryptionKey) {
    delete credentials[workstationId];
  } else {
    credentials[workstationId] = current;
  }
  await writeWebCredentials(credentials);
}

async function getWebEncryptionKey(workstationId: string): Promise<string | null> {
  const credentials = await readWebCredentials();
  return credentials[workstationId]?.encryptionKey ?? null;
}

async function setWebEncryptionKey(workstationId: string, key: string): Promise<void> {
  const credentials = await readWebCredentials();
  const current = credentials[workstationId] ?? {};
  current.encryptionKey = key;
  credentials[workstationId] = current;
  await writeWebCredentials(credentials);
}

async function deleteWebEncryptionKey(workstationId: string): Promise<void> {
  const credentials = await readWebCredentials();
  const current = credentials[workstationId];
  if (!current) {
    return;
  }
  delete current.encryptionKey;
  // If no credentials left, delete the entire entry
  if (!current.authToken) {
    delete credentials[workstationId];
  } else {
    credentials[workstationId] = current;
  }
  await writeWebCredentials(credentials);
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Get the auth token for a specific workstation.
 * Returns null if not found.
 */
export async function getWorkstationAuthToken(workstationId: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return getWebAuthToken(workstationId);
  }
  return getNativeAuthToken(workstationId);
}

/**
 * Set the auth token for a specific workstation.
 */
export async function setWorkstationAuthToken(
  workstationId: string,
  authToken: string
): Promise<void> {
  if (Platform.OS === 'web') {
    return setWebAuthToken(workstationId, authToken);
  }
  return setNativeAuthToken(workstationId, authToken);
}

/**
 * Delete the auth token for a specific workstation.
 */
export async function deleteWorkstationAuthToken(workstationId: string): Promise<void> {
  if (Platform.OS === 'web') {
    return deleteWebAuthToken(workstationId);
  }
  return deleteNativeAuthToken(workstationId);
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
 * Get all workstation credentials.
 * Web: returns all credentials from OPFS
 * Native: not supported (returns empty object)
 */
export async function getAllWorkstationCredentials(): Promise<WebCredentialsStore> {
  if (Platform.OS === 'web') {
    return readWebCredentials();
  }
  // Native doesn't support listing all keys efficiently
  return {};
}

/**
 * Clear all workstation auth tokens and encryption keys.
 */
export async function clearAllWorkstationCredentials(workstationIds?: string[]): Promise<void> {
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
    console.warn('[workstations] clearAllWorkstationCredentials needs workstation IDs on native');
    return;
  }

  for (const workstationId of workstationIds) {
    try {
      await deleteNativeAuthToken(workstationId);
      await deleteNativeEncryptionKey(workstationId);
    } catch (err) {
      console.warn(
        `[workstations] Failed to clear credentials for workstation ${workstationId}:`,
        err
      );
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
