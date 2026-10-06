import { isTauri } from "@tauri-apps/api/core";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

/**
 * fetch for the user's own endpoints (LLM, TTS). They send no CORS headers to the webview, so
 * inside Tauri requests go through Rust; in the browser (`pnpm dev`) the plain fetch is used.
 */
export function defaultFetch(): typeof fetch {
  return isTauri() ? (tauriFetch as typeof fetch) : globalThis.fetch.bind(globalThis);
}
