import { defaultFetch } from "../http.ts";
import { t } from "../i18n/index.ts";
import { type AudioCache, audioCache, audioCacheKey } from "./audioCache.ts";
import { ensureNotAborted, sleep, VoiceHttpError, VoiceUnavailableError } from "./errors.ts";
import { voiceSlots } from "./semaphore.ts";
import { ttsEngine } from "./tts/registry.ts";
import type { TtsContext, TtsEngine, TtsInput } from "./tts/types.ts";
import type { VoiceOptions } from "./voices.ts";

export interface SpeechSynth {
  /**
   * Audio for one sentence from the engine in `opts` (设置 → 语音). Cached by hash(text + engine +
   * voice + rate…) (memory LRU + IndexedDB). Global concurrency ≤ 3. Requested from this device
   * only; there is no server fallback, since the server must never see the brief in the clear
   * (end-to-end encryption). Throws VoiceUnavailableError when the engine fails, with the cause.
   * Abort → rejects with AbortError.
   */
  synthesize(text: string, opts: VoiceOptions, signal?: AbortSignal): Promise<Blob>;
}

const MAX_RETRIES = 2;

/** Failures worth another try: throttling, server errors and network failures. */
function transient(err: unknown): boolean {
  if (err instanceof VoiceHttpError) {
    const s = err.status;
    return s !== undefined && (s === 408 || s === 429 || s >= 500);
  }
  // fetch rejects with TypeError on network failures; the Tauri HTTP plugin with a plain string.
  return err instanceof TypeError || typeof err === "string";
}

/**
 * The shared request policy for engines that do not bring their own: at most 3 voice requests in
 * flight, and 2 retries of transient failures with exponential backoff (500 ms × 2ⁿ + jitter).
 */
async function withRetry<T>(send: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    ensureNotAborted(signal);
    try {
      return await voiceSlots.run(send, signal);
    } catch (err) {
      ensureNotAborted(signal);
      if (!transient(err) || attempt >= MAX_RETRIES) throw err;
      await sleep(500 * 2 ** attempt + Math.random() * 200, signal);
    }
  }
}

/** The input an engine gets: the rate clamped to what its API takes (1 when it takes none). */
export function engineInput(engine: TtsEngine, text: string, opts: VoiceOptions): TtsInput {
  const rate = engine.rate ? Math.min(engine.rate.max, Math.max(engine.rate.min, opts.rate)) : 1;
  const model = opts.config.model.trim() || engine.models[0] || "";
  return { text, voice: opts.voice, model, rate, language: opts.language };
}

/** Speech from the engine picked in 设置 → 语音, with a shared audio cache. */
export class SpeechSynthService implements SpeechSynth {
  readonly #cache: AudioCache;
  readonly #fetch: () => typeof fetch;
  readonly #engines: (id: string) => TtsEngine;

  constructor(
    cache: AudioCache = audioCache,
    fetchImpl: () => typeof fetch = defaultFetch,
    engines: (id: string) => TtsEngine = ttsEngine,
  ) {
    this.#cache = cache;
    this.#fetch = fetchImpl;
    this.#engines = engines;
  }

  async synthesize(text: string, opts: VoiceOptions, signal?: AbortSignal): Promise<Blob> {
    ensureNotAborted(signal);
    const sentence = text.trim();
    if (!sentence) throw new Error("synthesize: text is empty");
    const engine = this.#engines(opts.engine);
    const input = engineInput(engine, sentence, opts);
    const key = await audioCacheKey(engine, input, opts.config);
    const cached = await this.#cache.get(key);
    if (cached) return cached;
    const ctx: TtsContext = { fetch: this.#fetch(), signal };
    try {
      const send = () => engine.synthesize(input, opts.config, ctx);
      const audio = await (engine.ownsRequestPolicy ? send() : withRetry(send, signal));
      void this.#cache.set(key, audio);
      return audio;
    } catch (err) {
      ensureNotAborted(signal);
      throw new VoiceUnavailableError(t().call.voiceUnavailable, { cause: err });
    }
  }
}

/** The app's speech synthesizer (one shared cache). */
export function createSpeechSynth(): SpeechSynth {
  return new SpeechSynthService();
}
