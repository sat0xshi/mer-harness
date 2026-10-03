export const maxOriginals = 40;
export interface PhotoOriginal {
  original: Blob;
  enhancedBlob: Blob;
  enhanced: boolean;
}
interface StoredOriginal extends PhotoOriginal {
  photoId: string;
  savedAt: number;
}
const originals = new Map<string, StoredOriginal>();
const listeners = new Set<() => void>();
let revision = 0;
const changed = () => {
  revision++;
  for (const listener of listeners) listener();
};
export const originalsVersion = () => revision;
export function subscribeOriginals(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getPhotoOriginal(photoId: string): PhotoOriginal | undefined {
  return originals.get(photoId);
}
let database: Promise<IDBDatabase | null> | undefined;
function openDatabase() {
  database ??= new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") {
        resolve(null);
        return;
      }
      const request = indexedDB.open("fh-photos", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("originals", { keyPath: "photoId" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return database;
}
// Serialize hydration and writes: a slow read can never resurrect a deleted entry.
let loaded: Promise<void> | undefined;
export function loadPhotoOriginals(): Promise<void> {
  loaded ??= (async () => {
    const db = await openDatabase();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction("originals", "readwrite");
        const store = tx.objectStore("originals");
        const request = store.getAll();
        request.onsuccess = () => {
          const rows = (request.result as StoredOriginal[]).sort((a, b) => a.savedAt - b.savedAt);
          for (const row of rows.slice(0, Math.max(0, rows.length - maxOriginals)))
            store.delete(row.photoId);
          for (const row of rows.slice(-maxOriginals)) {
            if (row.original instanceof Blob && row.enhancedBlob instanceof Blob)
              originals.set(row.photoId, row);
          }
          changed();
        };
        tx.oncomplete = () => resolve();
        tx.onerror = tx.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  })();
  return loaded;
}
let writes = Promise.resolve();
function persist(row: StoredOriginal | null, removed: string[]) {
  writes = writes
    .then(async () => {
      const db = await openDatabase();
      if (!db) return;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction("originals", "readwrite"),
            store = tx.objectStore("originals");
          for (const id of removed) store.delete(id);
          if (row) store.put(row);
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    })
    .catch(() => {});
  return writes;
}
export async function setPhotoOriginal(photoId: string, value: PhotoOriginal): Promise<void> {
  await loadPhotoOriginals();
  const row = { ...value, photoId, savedAt: originals.get(photoId)?.savedAt ?? Date.now() };
  originals.set(photoId, row);
  const removed: string[] = [];
  while (originals.size > maxOriginals) {
    const oldest = originals.keys().next().value;
    if (oldest === undefined) break;
    originals.delete(oldest);
    removed.push(oldest);
  }
  changed();
  void persist(row, removed);
}
export async function deletePhotoOriginal(photoId: string): Promise<void> {
  await loadPhotoOriginals();
  originals.delete(photoId);
  changed();
  void persist(null, [photoId]);
}
