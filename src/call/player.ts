import { t } from "../i18n/index.ts";
import type { SpeechSynth, VoiceOptions } from "../voice/index.ts";

export function isAbortError(err: unknown): boolean {
  return (err as { name?: unknown } | null)?.name === "AbortError";
}

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

/**
 * How long a sentence stays on screen when there is no audio: roughly a Mandarin speaking pace
 * (~4.5 characters per second at rate 1), never shorter than 1.5 s.
 */
export function readingTimeMs(text: string, rate: number): number {
  return Math.max(1_500, text.length * 220) / rate;
}

/** Resolves like `promise`, but rejects with `AbortError` as soon as `signal` aborts. */
function unlessAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

/**
 * Speaks one sentence at a time on a single audio element. Synthesis of the sentences expected next
 * starts ahead of time (`upcoming`); fetches that are no longer wanted are aborted so they do not hold
 * the synthesizer's limited concurrency.
 */
export class SentencePlayer {
  readonly #synth: SpeechSynth;
  readonly #audio = new Audio();
  readonly #fetches = new Map<string, { ctrl: AbortController; blob: Promise<Blob> }>();

  constructor(synth: SpeechSynth) {
    this.#synth = synth;
  }

  /**
   * Plays `text` to its end while prefetching `upcoming`. Aborting `signal` stops the audio at once and
   * rejects with `AbortError`; synthesis failures (e.g. `VoiceUnavailableError`) propagate.
   */
  async play(
    text: string,
    upcoming: string[],
    opts: VoiceOptions,
    signal: AbortSignal,
  ): Promise<void> {
    const wanted = new Set([text, ...upcoming].map((t) => fetchKey(t, opts)));
    for (const [key, fetch] of this.#fetches) {
      if (wanted.has(key)) continue;
      fetch.ctrl.abort();
      this.#fetches.delete(key);
    }
    const blob = this.prefetch(text, opts);
    for (const t of upcoming) this.prefetch(t, opts);
    await this.#playBlob(await unlessAborted(blob, signal), signal);
  }

  /** Starts synthesizing `text` unless already under way; failures surface when it is played. */
  prefetch(text: string, opts: VoiceOptions): Promise<Blob> {
    const key = fetchKey(text, opts);
    const existing = this.#fetches.get(key);
    if (existing) return existing.blob;
    const ctrl = new AbortController();
    const blob = this.#synth.synthesize(text, opts, ctrl.signal);
    const entry = { ctrl, blob };
    this.#fetches.set(key, entry);
    // A failed fetch is retried on the next play instead of replaying the same rejection.
    blob.catch(() => {
      if (this.#fetches.get(key) === entry) this.#fetches.delete(key);
    });
    return blob;
  }

  /** Silences the audio and abandons pending synthesis; the player stays usable. */
  stop(): void {
    this.#audio.pause();
    for (const fetch of this.#fetches.values()) fetch.ctrl.abort();
    this.#fetches.clear();
  }

  async #playBlob(blob: Blob, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
    const audio = this.#audio;
    const url = URL.createObjectURL(blob);
    try {
      await new Promise<void>((resolve, reject) => {
        const settle = (err?: unknown) => {
          audio.onended = null;
          audio.onerror = null;
          signal.removeEventListener("abort", onAbort);
          if (err === undefined) resolve();
          else reject(err);
        };
        const onAbort = () => {
          audio.pause();
          settle(abortError());
        };
        audio.onended = () => settle();
        audio.onerror = () =>
          settle(new Error(t().call.audioFailed(String(audio.error?.code ?? "?"))));
        signal.addEventListener("abort", onAbort, { once: true });
        audio.src = url;
        audio.play().catch((err: unknown) => settle(err));
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

function fetchKey(text: string, opts: VoiceOptions): string {
  return `${opts.engine}|${opts.config.model}|${opts.voice}|${opts.rate}|${text}`;
}

/**
 * Speaks a streamed LLM answer: sentences are queued as they complete and played in order, each one
 * synthesized as soon as it is queued so the first sentence starts as early as possible.
 */
export class AnswerSpeech {
  readonly #player: SentencePlayer;
  readonly #opts: VoiceOptions;
  readonly #signal: AbortSignal;
  readonly #onSentence: (sentence: string) => void;
  readonly #queue: string[] = [];
  #ended = false;
  #wake: (() => void) | null = null;
  /** Settles once every sentence queued before `end()` was spoken; rejects on abort or voice failure. */
  readonly done: Promise<void>;

  constructor(
    player: SentencePlayer,
    opts: VoiceOptions,
    signal: AbortSignal,
    onSentence: (sentence: string) => void,
  ) {
    this.#player = player;
    this.#opts = opts;
    this.#signal = signal;
    this.#onSentence = onSentence;
    this.done = this.#run();
    // Callers may stop listening (abort) without awaiting `done`.
    this.done.catch(() => {});
  }

  push(sentences: string[]): void {
    for (const s of sentences) {
      this.#queue.push(s);
      this.#player.prefetch(s, this.#opts).catch(() => {});
    }
    this.#wake?.();
  }

  /** No more sentences will be pushed. */
  end(): void {
    this.#ended = true;
    this.#wake?.();
  }

  async #run(): Promise<void> {
    for (;;) {
      const next = this.#queue.shift();
      if (next === undefined) {
        if (this.#ended) return;
        await unlessAborted(
          new Promise<void>((resolve) => {
            this.#wake = resolve;
          }),
          this.#signal,
        );
        this.#wake = null;
        continue;
      }
      this.#onSentence(next);
      await this.#player.play(next, this.#queue, this.#opts, this.#signal);
    }
  }
}
