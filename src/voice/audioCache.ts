import type { TtsConfig, TtsEngine, TtsInput } from "./tts/types.ts";

const STORE = "audio";
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

interface StoredAudio {
  key: string;
  audio: ArrayBuffer;
  type: string;
  savedAt: number;
}

/**
 * SHA-256 hex of everything that changes the audio — engine, model, voice, language, rate, the
 * engine's non-secret settings (e.g. a self-hosted address, a custom request) and the text — so
 * identical sentences are synthesized once. Keys and tokens are left out: a new key speaks the same.
 */
export async function audioCacheKey(
  engine: TtsEngine,
  input: TtsInput,
  config: TtsConfig,
): Promise<string> {
  const secret = new Set(engine.fields.filter((f) => f.kind === "secret").map((f) => f.key));
  const settings = Object.entries(config.values)
    .filter(([k]) => !secret.has(k))
    .sort(([a], [b]) => a.localeCompare(b));
  const parts = [
    engine.id,
    input.model,
    input.voice,
    input.language,
    String(input.rate),
    JSON.stringify(settings),
    config.request ? JSON.stringify(config.request) : "",
    input.text,
  ];
  const data = new TextEncoder().encode(parts.join("|"));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Two-level synthesized-audio cache: an in-memory LRU plus a persistent IndexedDB store (entries
 * older than 30 days are pruned on open). IndexedDB is skipped when unavailable or broken.
 */
export class AudioCache {
  readonly #memory = new Map<string, Blob>();
  readonly #limit: number;
  readonly #dbName: string | null;
  #db: Promise<IDBDatabase | null> | undefined;

  /** `dbName: null` keeps the cache memory-only. */
  constructor(limit = 200, dbName: string | null = "outbrief-tts") {
    this.#limit = limit;
    this.#dbName = dbName;
  }

  async get(key: string): Promise<Blob | undefined> {
    const hit = this.#memory.get(key);
    if (hit) {
      this.#remember(key, hit);
      return hit;
    }
    const db = await this.#open();
    if (!db) return undefined;
    try {
      const store = db.transaction(STORE, "readonly").objectStore(STORE);
      const row = (await requestResult(store.get(key))) as StoredAudio | undefined;
      if (!row) return undefined;
      const blob = new Blob([row.audio], { type: row.type });
      this.#remember(key, blob);
      return blob;
    } catch (err) {
      console.warn("[outbrief] tts cache read failed", err);
      return undefined;
    }
  }

  async set(key: string, blob: Blob): Promise<void> {
    this.#remember(key, blob);
    const db = await this.#open();
    if (!db) return;
    try {
      // WebKit has a history of broken Blob storage in IndexedDB; ArrayBuffers are safe.
      const row: StoredAudio = {
        key,
        audio: await blob.arrayBuffer(),
        type: blob.type,
        savedAt: Date.now(),
      };
      await requestResult(db.transaction(STORE, "readwrite").objectStore(STORE).put(row));
    } catch (err) {
      console.warn("[outbrief] tts cache write failed", err);
    }
  }

  #remember(key: string, blob: Blob): void {
    this.#memory.delete(key);
    this.#memory.set(key, blob);
    if (this.#memory.size > this.#limit) {
      const oldest = this.#memory.keys().next().value;
      if (oldest !== undefined) this.#memory.delete(oldest);
    }
  }

  #open(): Promise<IDBDatabase | null> {
    const dbName = this.#dbName;
    if (dbName === null || typeof indexedDB === "undefined") return Promise.resolve(null);
    this.#db ??= (async () => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(STORE, { keyPath: "key" }).createIndex("savedAt", "savedAt");
      };
      const db = await requestResult(req);
      const expired = IDBKeyRange.upperBound(Date.now() - MAX_AGE_MS);
      const index = db.transaction(STORE, "readwrite").objectStore(STORE).index("savedAt");
      const prune = index.openCursor(expired);
      prune.onsuccess = () => {
        prune.result?.delete();
        prune.result?.continue();
      };
      return db;
    })().catch((err: unknown) => {
      console.warn("[outbrief] tts cache unavailable", err);
      return null;
    });
    return this.#db;
  }
}

/** App-wide cache shared by every SpeechSynth instance. */
export const audioCache = new AudioCache();
