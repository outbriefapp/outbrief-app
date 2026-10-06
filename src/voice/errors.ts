/** Thrown when neither client-side Azure nor the server fallback can produce audio → call degrades to cards + text. */
export class VoiceUnavailableError extends Error {
  override name = "VoiceUnavailableError";
}

/** A failed voice HTTP call. `status` is absent for network failures and malformed 200 responses. */
export class VoiceHttpError extends Error {
  override name = "VoiceHttpError";
  readonly status: number | undefined;

  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

/** Throws a DOMException named `AbortError` (regardless of the signal's custom reason) once aborted. */
export function ensureNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("The operation was aborted.", "AbortError");
}

/** Resolves after `ms`, or rejects with `AbortError` as soon as `signal` aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("The operation was aborted.", "AbortError"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Reads a response body for an error message without letting a broken body mask the status. */
export async function responseSnippet(resp: Response): Promise<string> {
  const body = await resp.text().catch(() => "");
  return body.slice(0, 200);
}
