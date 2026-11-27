import { afterEach, describe, expect, it } from 'vitest';
import {
  deriveKekFromPassphrase,
  generateDek,
  generateSalt,
  unwrapDek,
  wrapDek,
} from './crypto';
import { clearCachedDek, loadCachedDek, saveCachedDek } from './dekCache';

function createFakeIndexedDb(): IDBFactory {
  const stores = new Map<string, Map<string, unknown>>();

  const makeRequest = <T>(executor: () => T) => {
    const req: {
      result?: T;
      error?: unknown;
      onsuccess: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
    } = {
      onsuccess: null,
      onerror: null,
    };
    queueMicrotask(() => {
      try {
        req.result = executor();
        req.onsuccess?.(new Event('success'));
      } catch (err) {
        req.error = err;
        req.onerror?.(new Event('error'));
      }
    });
    return req;
  };

  return {
    open(name: string) {
      const openReq: {
        result?: IDBDatabase;
        error?: unknown;
        onupgradeneeded: ((ev: IDBVersionChangeEvent) => void) | null;
        onsuccess: ((ev: Event) => void) | null;
        onerror: ((ev: Event) => void) | null;
        onblocked: ((ev: Event) => void) | null;
      } = {
        onupgradeneeded: null,
        onsuccess: null,
        onerror: null,
        onblocked: null,
      };

      const existed = stores.has(name);
      if (!existed) {
        stores.set(name, new Map());
      }
      const dataMap = stores.get(name)!;
      const storeNames = new Set<string>(existed ? ['deks'] : []);

      const db = {
        objectStoreNames: {
          contains: (storeName: string) => storeNames.has(storeName),
        },
        createObjectStore: (storeName: string) => {
          storeNames.add(storeName);
          return {};
        },
        transaction: () => {
          const tx: {
            oncomplete: ((ev: Event) => void) | null;
            onerror: ((ev: Event) => void) | null;
            onabort: ((ev: Event) => void) | null;
            objectStore: () => unknown;
          } = {
            oncomplete: null,
            onerror: null,
            onabort: null,
            objectStore: () => ({
              put: (record: { uid: string }) => {
                const req = makeRequest(() => {
                  dataMap.set(record.uid, record);
                  return record.uid;
                });
                queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
                return req;
              },
              get: (uid: string) => makeRequest(() => dataMap.get(uid)),
              delete: (uid: string) => {
                const req = makeRequest(() => {
                  dataMap.delete(uid);
                  return undefined;
                });
                queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
                return req;
              },
              clear: () => {
                const req = makeRequest(() => {
                  dataMap.clear();
                  return undefined;
                });
                queueMicrotask(() => tx.oncomplete?.(new Event('complete')));
                return req;
              },
            }),
          };
          return tx;
        },
        close: () => undefined,
      } as unknown as IDBDatabase;

      openReq.result = db;
      queueMicrotask(() => {
        if (!existed) {
          openReq.onupgradeneeded?.({} as IDBVersionChangeEvent);
        }
        openReq.onsuccess?.(new Event('success'));
      });

      return openReq as unknown as IDBOpenDBRequest;
    },
  } as unknown as IDBFactory;
}

describe('dekCache', () => {
  const originalIndexedDb = globalThis.indexedDB;

  afterEach(() => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: originalIndexedDb,
    });
  });

  it('refuses to cache an extractable CryptoKey', async () => {
    const extractableDek = await generateDek();
    await expect(saveCachedDek('user-1', extractableDek)).rejects.toThrow(
      'extractable',
    );
  });

  it('degrades gracefully when indexedDB is unavailable', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const salt = generateSalt(16);
    const kek = await deriveKekFromPassphrase('correct-horse-battery-staple', salt, 10_000);
    const wrapped = await wrapDek(await generateDek(), kek);
    const nonExtractableDek = await unwrapDek(wrapped, kek, false);

    expect(await saveCachedDek('user-1', nonExtractableDek)).toBe(false);
    expect(await loadCachedDek('user-1')).toBeNull();
    await expect(clearCachedDek('user-1')).resolves.toBeUndefined();
  });

  it('saves, loads, and clears a non-extractable CryptoKey via IndexedDB', async () => {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: createFakeIndexedDb(),
    });

    const salt = generateSalt(16);
    const kek = await deriveKekFromPassphrase('correct-horse-battery-staple', salt, 10_000);
    const wrapped = await wrapDek(await generateDek(), kek);
    const nonExtractableDek = await unwrapDek(wrapped, kek, false);

    expect(await saveCachedDek('user-1', nonExtractableDek)).toBe(true);

    const loaded = await loadCachedDek('user-1');
    expect(loaded).toBe(nonExtractableDek);
    expect(loaded?.extractable).toBe(false);

    await clearCachedDek('user-1');
    expect(await loadCachedDek('user-1')).toBeNull();

    // Clear all
    expect(await saveCachedDek('user-2', nonExtractableDek)).toBe(true);
    await clearCachedDek();
    expect(await loadCachedDek('user-2')).toBeNull();
  });
});
