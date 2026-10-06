import type { AzureEndpoint, AzureTokenProvider } from "./azureToken.ts";
import { ensureNotAborted, sleep, VoiceHttpError } from "./errors.ts";
import { voiceSlots } from "./semaphore.ts";

const MAX_RETRIES = 2;

/**
 * Runs one Azure speech request under the shared concurrency limit with the path-B retry policy:
 * - 400 (bad SSML/audio), 403 (client blocked), 429 (throttled): fail immediately so the caller can
 *   degrade to the server;
 * - 401: drop the JWT, fetch a new one and retry once;
 * - 408, 5xx, network or malformed responses: exponential backoff (500 ms × 2ⁿ + jitter), 2 retries.
 *
 * `send` must throw {@link VoiceHttpError} with the HTTP status for non-2xx responses.
 */
export async function withAzureRetry<T>(
  tokens: AzureTokenProvider,
  send: (endpoint: AzureEndpoint) => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let refreshed = false;
  let attempt = 0;
  for (;;) {
    ensureNotAborted(signal);
    const endpoint = await tokens.get();
    try {
      return await voiceSlots.run(() => send(endpoint), signal);
    } catch (err) {
      ensureNotAborted(signal);
      const status = err instanceof VoiceHttpError ? err.status : undefined;
      if (status === 401 && !refreshed) {
        tokens.invalidate(endpoint);
        refreshed = true;
        continue;
      }
      const transient = status === undefined || status === 408 || status >= 500;
      if (!transient || attempt >= MAX_RETRIES) throw err;
      await sleep(500 * 2 ** attempt + Math.random() * 200, signal);
      attempt += 1;
    }
  }
}
