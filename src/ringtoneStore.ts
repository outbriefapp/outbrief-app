const DB_NAME = "outbrief-ringtones";
const STORE = "tones";

interface StoredTone {
  id: string;
  audio: ArrayBuffer;
  type: string;
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db: Promise<IDBDatabase> | undefined;

function open(): Promise<IDBDatabase> {
  db ??= (() => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    return requestResult(req);
  })();
  return db;
}

/**
 * The audio of the user's own ringtones, on this device only; settings keep just their ids and
 * names. Stored as ArrayBuffers: WebKit has a history of broken Blob storage in IndexedDB.
 */
export async function saveRingtoneAudio(id: string, file: Blob): Promise<void> {
  const row: StoredTone = { id, audio: await file.arrayBuffer(), type: file.type };
  const store = (await open()).transaction(STORE, "readwrite").objectStore(STORE);
  await requestResult(store.put(row));
}

export async function loadRingtoneAudio(id: string): Promise<Blob> {
  const store = (await open()).transaction(STORE, "readonly").objectStore(STORE);
  const row = (await requestResult(store.get(id))) as StoredTone | undefined;
  if (!row) throw new Error(`ringtone ${id} is not on this device`);
  return new Blob([row.audio], { type: row.type });
}

export async function deleteRingtoneAudio(id: string): Promise<void> {
  const store = (await open()).transaction(STORE, "readwrite").objectStore(STORE);
  await requestResult(store.delete(id));
}
