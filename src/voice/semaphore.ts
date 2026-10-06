import { ensureNotAborted } from "./errors.ts";

/** FIFO counting semaphore; waiting callers can bail out via their AbortSignal. */
export class Semaphore {
  #free: number;
  readonly #waiters: (() => void)[] = [];

  constructor(permits: number) {
    this.#free = permits;
  }

  /** Runs `task` once a permit is available and releases the permit when it settles. */
  async run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    await this.#acquire(signal);
    try {
      return await task();
    } finally {
      const next = this.#waiters.shift();
      if (next) next();
      else this.#free += 1;
    }
  }

  #acquire(signal: AbortSignal | undefined): Promise<void> {
    ensureNotAborted(signal);
    if (this.#free > 0) {
      this.#free -= 1;
      return Promise.resolve();
    }
    // Executor form: the ES2023 lib targeted by tsconfig has no Promise.withResolvers.
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        this.#waiters.splice(this.#waiters.indexOf(grant), 1);
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      this.#waiters.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  }
}

/** Shared by every Azure / server voice request (TTS + STT) so we never exceed 3 in flight. */
export const voiceSlots = new Semaphore(3);
