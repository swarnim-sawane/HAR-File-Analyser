// src/services/recentFilesStore.ts
//
// Persists recent file content in IndexedDB so files can be reopened after a
// page refresh — localStorage only stores name/timestamp metadata, not file bytes.

const DB_NAME = 'oca-recent-files';
const DB_VERSION = 1;
const STORE_NAME = 'files';
const MAX_FILES_PER_KIND = 5;

interface StoredFile {
  key: string;       // e.g. "log:myfile.txt" or "har:myfile.har"
  kind: 'log' | 'har';
  name: string;
  content: ArrayBuffer;
  mimeType: string;
  size: number;
  timestamp: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('kind', 'kind', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * Save a file's content to IndexedDB.
 * Automatically evicts the oldest entry if the per-kind limit is exceeded.
 */
export async function storeRecentFile(kind: 'log' | 'har', file: File): Promise<void> {
  if (!file || file.size === 0) return; // nothing meaningful to persist
  try {
    const content = await file.arrayBuffer();
    const db = await openDB();
    const key = `${kind}:${file.name}`;

    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    // Evict oldest entries for this kind if over the limit
    const allKeys: StoredFile[] = await idbRequest(
      store.index('kind').getAll(IDBKeyRange.only(kind))
    );
    allKeys.sort((a, b) => a.timestamp - b.timestamp); // oldest first
    const toDelete = allKeys.filter((r) => r.key !== key);
    while (toDelete.length >= MAX_FILES_PER_KIND) {
      const oldest = toDelete.shift()!;
      store.delete(oldest.key);
    }

    const record: StoredFile = {
      key,
      kind,
      name: file.name,
      content,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      timestamp: Date.now(),
    };
    store.put(record);
    await idbTx(tx);
    db.close();
  } catch (err) {
    // Non-fatal — recent files are a convenience feature
    console.warn('[recentFilesStore] Failed to store file:', err);
  }
}

/**
 * Restore a previously stored file from IndexedDB by name.
 * Returns null if the file was never stored or was evicted.
 */
export async function restoreRecentFile(kind: 'log' | 'har', name: string): Promise<File | null> {
  try {
    const db = await openDB();
    const key = `${kind}:${name}`;
    const tx = db.transaction(STORE_NAME, 'readonly');
    const record: StoredFile | undefined = await idbRequest(
      tx.objectStore(STORE_NAME).get(key)
    );
    db.close();
    if (!record) return null;
    return new File([record.content], record.name, { type: record.mimeType });
  } catch (err) {
    console.warn('[recentFilesStore] Failed to restore file:', err);
    return null;
  }
}

/**
 * Remove a specific file from the store.
 */
export async function deleteRecentFile(kind: 'log' | 'har', name: string): Promise<void> {
  try {
    const db = await openDB();
    const key = `${kind}:${name}`;
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    await idbTx(tx);
    db.close();
  } catch (err) {
    console.warn('[recentFilesStore] Failed to delete file:', err);
  }
}

/**
 * Remove all stored files of a given kind (e.g. when user clicks "Clear All").
 */
export async function clearRecentFiles(kind: 'log' | 'har'): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const records: StoredFile[] = await idbRequest(
      store.index('kind').getAll(IDBKeyRange.only(kind))
    );
    for (const r of records) store.delete(r.key);
    await idbTx(tx);
    db.close();
  } catch (err) {
    console.warn('[recentFilesStore] Failed to clear files:', err);
  }
}
