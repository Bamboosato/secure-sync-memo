const DEK_DB_NAME = 'secure-sync-memo-keys';
const DEK_DB_VERSION = 1;
const DEK_STORE_NAME = 'deks';

interface CachedDekRecord {
  uid: string;
  key: CryptoKey;
  savedAt: number;
}

function getIndexedDb(): IDBFactory | null {
  try {
    return typeof globalThis.indexedDB !== 'undefined' ? globalThis.indexedDB : null;
  } catch {
    return null;
  }
}

function openDekDatabase(): Promise<IDBDatabase | null> {
  const idb = getIndexedDb();
  if (!idb) {
    return Promise.resolve(null);
  }

  return new Promise((resolve, reject) => {
    const request = idb.open(DEK_DB_NAME, DEK_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEK_STORE_NAME)) {
        db.createObjectStore(DEK_STORE_NAME, { keyPath: 'uid' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error ?? new Error('Failed to open key cache database.'));
    };

    request.onblocked = () => {
      resolve(null);
    };
  });
}

function isNonExtractableCryptoKey(value: unknown): value is CryptoKey {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as CryptoKey;
  return (
    candidate.extractable === false &&
    typeof candidate.type === 'string' &&
    Array.isArray(candidate.usages)
  );
}

/**
 * Persists a non-extractable DEK CryptoKey in IndexedDB for per-device auto-unlock.
 */
export async function saveCachedDek(uid: string, dek: CryptoKey): Promise<boolean> {
  if (dek.extractable) {
    throw new Error('Refusing to cache an extractable CryptoKey.');
  }

  let db: IDBDatabase | null = null;
  try {
    db = await openDekDatabase();
    if (!db) {
      return false;
    }

    const activeDb = db;
    const result = await new Promise<boolean>((resolve) => {
      const tx = activeDb.transaction(DEK_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DEK_STORE_NAME);
      const record: CachedDekRecord = {
        uid,
        key: dek,
        savedAt: Date.now(),
      };

      const req = store.put(record);
      req.onerror = () => resolve(false);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    });
    return result;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

/**
 * Loads a previously cached non-extractable DEK CryptoKey for the given user.
 */
export async function loadCachedDek(uid: string): Promise<CryptoKey | null> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDekDatabase();
    if (!db) {
      return null;
    }

    const activeDb = db;
    const record = await new Promise<CachedDekRecord | undefined>((resolve) => {
      const tx = activeDb.transaction(DEK_STORE_NAME, 'readonly');
      const store = tx.objectStore(DEK_STORE_NAME);
      const req = store.get(uid);
      req.onsuccess = () => resolve(req.result as CachedDekRecord | undefined);
      req.onerror = () => resolve(undefined);
      tx.onerror = () => resolve(undefined);
    });

    if (!record) {
      return null;
    }

    if (!isNonExtractableCryptoKey(record.key)) {
      await clearCachedDek(uid);
      return null;
    }

    return record.key;
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

/**
 * Removes cached DEK CryptoKeys from IndexedDB (for a single user or all users).
 */
export async function clearCachedDek(uid?: string): Promise<void> {
  let db: IDBDatabase | null = null;
  try {
    db = await openDekDatabase();
    if (!db) {
      return;
    }

    const activeDb = db;
    await new Promise<void>((resolve) => {
      const tx = activeDb.transaction(DEK_STORE_NAME, 'readwrite');
      const store = tx.objectStore(DEK_STORE_NAME);
      const req = uid ? store.delete(uid) : store.clear();
      req.onerror = () => resolve();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // Ignore cleanup errors when IndexedDB is unavailable or blocked.
  } finally {
    db?.close();
  }
}
