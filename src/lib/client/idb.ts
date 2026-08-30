'use client';

import type { Chunk, DocMeta } from '../types.ts';

/**
 * All user data lives here, in the user's own browser.
 *
 * This is the central storage decision of the project: uploaded documents are
 * chunked, indexed and searched on-device, and only the handful of retrieved
 * passages ever travel to the model. Nothing is written to a server disk, so
 * deploying to Vercel needs no blob store, no database and no per-user quota -
 * and a person uploading their rent agreement or salary slip keeps it.
 */

const DB_NAME = 'kanoonai';
const DB_VERSION = 1;

export const STORES = {
  docs: 'docs',
  chunks: 'chunks',
  corpus: 'corpus',
  meta: 'meta',
  chats: 'chats',
} as const;

let dbPromise: Promise<IDBDatabase> | null = null;

export function idbAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false; // Safari private mode and some embedded webviews throw on access
  }
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!idbAvailable()) {
      reject(new Error('This browser has no storage available (private mode?).'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.docs)) {
        db.createObjectStore(STORES.docs, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.chunks)) {
        const s = db.createObjectStore(STORES.chunks, { keyPath: 'id' });
        s.createIndex('docId', 'docId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORES.corpus)) {
        db.createObjectStore(STORES.corpus, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORES.meta)) {
        db.createObjectStore(STORES.meta, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORES.chats)) {
        db.createObjectStore(STORES.chats, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => req.result.close();
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error('Could not open local storage.'));
    req.onblocked = () => reject(new Error('Storage is blocked by another open tab.'));
  });
  return dbPromise;
}

function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted.'));
      }),
  );
}

export const put = <T>(store: string, value: T) => tx(store, 'readwrite', (s) => s.put(value as object));
export const get = <T>(store: string, key: IDBValidKey) => tx<T | undefined>(store, 'readonly', (s) => s.get(key));
export const getAll = <T>(store: string) => tx<T[]>(store, 'readonly', (s) => s.getAll());
export const del = (store: string, key: IDBValidKey) => tx(store, 'readwrite', (s) => s.delete(key));
export const clear = (store: string) => tx(store, 'readwrite', (s) => s.clear());

/** Bulk insert in one transaction; a per-record put would be ~50x slower. */
export async function putMany<T>(store: string, values: T[]): Promise<void> {
  if (!values.length) return;
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(store, 'readwrite');
    const s = t.objectStore(store);
    for (const v of values) s.put(v as object);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error('Bulk write aborted (storage full?).'));
  });
}

export async function getChunksByDoc(docId: string): Promise<Chunk[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORES.chunks, 'readonly').objectStore(STORES.chunks).index('docId').getAll(docId);
    req.onsuccess = () => resolve(req.result as Chunk[]);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteDoc(docId: string): Promise<void> {
  const chunks = await getChunksByDoc(docId);
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const t = db.transaction([STORES.docs, STORES.chunks], 'readwrite');
    t.objectStore(STORES.docs).delete(docId);
    const cs = t.objectStore(STORES.chunks);
    for (const c of chunks) cs.delete(c.id);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

export const listDocs = () => getAll<DocMeta>(STORES.docs);
export const allUserChunks = () => getAll<Chunk>(STORES.chunks);

/** How much of the browser's storage budget we are using. */
export async function storageEstimate(): Promise<{ usedMB: number; quotaMB: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usedMB: usage / 1e6, quotaMB: quota / 1e6 };
}

/** Wipe everything this app stored. Offered in the UI, and used by the tests. */
export async function wipeAll(): Promise<void> {
  await Promise.all(Object.values(STORES).map((s) => clear(s).catch(() => undefined)));
}
