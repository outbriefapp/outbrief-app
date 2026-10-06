import { responseSnippet, VoiceHttpError } from "../errors.ts";

/**
 * Turning what TTS APIs return into a playable Blob: raw audio, base64 / hex in JSON (also one
 * JSON object per line, as streaming APIs send), audio URLs and headerless 16-bit PCM.
 */

export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const clean = base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
  const std = clean.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(std.padEnd(Math.ceil(std.length / 4) * 4, "="));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) throw new Error("not hex audio");
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** The MIME type of an audio file by its first bytes; null when it is not a known container. */
export function sniffAudio(bytes: Uint8Array): string | null {
  const ascii = (at: number, s: string) =>
    [...s].every((c, i) => bytes[at + i] === c.charCodeAt(0));
  if (ascii(0, "RIFF") && ascii(8, "WAVE")) return "audio/wav";
  if (ascii(0, "ID3")) return "audio/mpeg";
  if (ascii(0, "OggS")) return "audio/ogg";
  if (ascii(0, "fLaC")) return "audio/flac";
  if (ascii(4, "ftyp")) return "audio/mp4";
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    return "audio/webm";
  }
  // MPEG audio frame sync (mp3 without an ID3 tag) or ADTS AAC.
  if (bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) {
    return ((bytes[1] ?? 0) & 0x06) === 0 ? "audio/aac" : "audio/mpeg";
  }
  return null;
}

/** Headerless little-endian 16-bit mono PCM → a WAV file. */
export function pcm16ToWav(pcm: Uint8Array, sampleRate: number): Blob {
  const length = pcm.byteLength & ~1;
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, length, true);
  return new Blob([header, pcm.slice(0, length)], { type: "audio/wav" });
}

/** How to read the audio bytes: a known container, or headerless 16-bit mono PCM at a rate. */
export type AudioFormat = { kind: "auto" } | { kind: "pcm16"; sampleRate: number };

export const AUTO_FORMAT: AudioFormat = { kind: "auto" };

/** Bytes → a Blob the audio element can play. Refuses bytes that are no known audio file. */
export function toAudioBlob(bytes: Uint8Array<ArrayBuffer>, format: AudioFormat): Blob {
  if (bytes.byteLength === 0) throw new VoiceHttpError("TTS returned empty audio");
  if (format.kind === "pcm16") return pcm16ToWav(bytes, format.sampleRate);
  const type = sniffAudio(bytes);
  if (!type) {
    const text = new TextDecoder().decode(bytes.slice(0, 200));
    throw new VoiceHttpError(`TTS returned no recognisable audio: ${text}`);
  }
  return new Blob([bytes], { type });
}

/** Throws `VoiceHttpError` with the status and the start of the body for a non-2xx response. */
export async function ensureOk(resp: Response, what: string): Promise<Response> {
  if (!resp.ok) {
    throw new VoiceHttpError(
      `${what} HTTP ${resp.status}: ${await responseSnippet(resp)}`,
      resp.status,
    );
  }
  return resp;
}

/** A response whose body is the audio itself. */
export async function audioBody(resp: Response, what: string, format = AUTO_FORMAT): Promise<Blob> {
  await ensureOk(resp, what);
  const bytes = new Uint8Array(await resp.arrayBuffer());
  const type = resp.headers.get("content-type") ?? "";
  if (/json|text\//i.test(type)) {
    const text = new TextDecoder().decode(bytes.slice(0, 200));
    throw new VoiceHttpError(`${what} returned ${type} instead of audio: ${text}`);
  }
  return toAudioBlob(bytes, format);
}

/**
 * The value at `path` in `json`: dot-separated keys and array indices, "data.audio",
 * "candidates.0.content.parts[0].inlineData.data". An empty path is the value itself.
 */
export function valueAt(json: unknown, path: string): unknown {
  const keys = path
    .trim()
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let value = json;
  for (const key of keys) {
    if (value === null || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/**
 * The JSON documents in a body: one document, or one per line (NDJSON, or SSE `data:` lines) as
 * streaming TTS APIs send them. Throws when the body is not JSON.
 */
export function jsonDocuments(body: string): unknown[] {
  const text = body.trim();
  try {
    return [JSON.parse(text)];
  } catch {
    const docs: unknown[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/^data:\s*/, "").trim();
      if (!line || line === "[DONE]" || /^(event|id|retry):/.test(raw)) continue;
      try {
        docs.push(JSON.parse(line));
      } catch {
        throw new VoiceHttpError(`TTS returned something that is not JSON: ${text.slice(0, 200)}`);
      }
    }
    if (docs.length === 0) throw new VoiceHttpError("TTS returned an empty body");
    return docs;
  }
}

export type AudioEncoding = "base64" | "hex";

/**
 * The audio in a JSON (or line-delimited JSON) body: the string at `path` of every document,
 * decoded and joined in order. Documents without it (progress, final status) are skipped.
 */
export function audioFromJson(
  docs: unknown[],
  path: string,
  encoding: AudioEncoding,
): Uint8Array<ArrayBuffer> {
  const parts = docs
    .map((doc) => valueAt(doc, path))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map((v) => (encoding === "hex" ? hexToBytes(v) : base64ToBytes(v)));
  if (parts.length === 0) {
    const sample = JSON.stringify(docs[docs.length - 1] ?? null).slice(0, 200);
    throw new VoiceHttpError(`TTS response has no audio at "${path}": ${sample}`);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** Downloads an audio URL a TTS API answered with. */
export async function audioFromUrl(
  url: unknown,
  ctx: { fetch: typeof fetch; signal?: AbortSignal },
  format = AUTO_FORMAT,
): Promise<Blob> {
  if (typeof url !== "string" || !/^https?:\/\//.test(url)) {
    throw new VoiceHttpError(`TTS response has no audio URL: ${String(url).slice(0, 200)}`);
  }
  return audioBody(await ctx.fetch(url, { signal: ctx.signal }), "TTS audio download", format);
}

/** POSTs `body` as JSON. */
export function postJson(
  ctx: { fetch: typeof fetch; signal?: AbortSignal },
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<Response> {
  return ctx.fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: ctx.signal,
  });
}

/** The JSON body of a 2xx response; `VoiceHttpError` otherwise. */
export async function jsonBody<T>(resp: Response, what: string): Promise<T> {
  await ensureOk(resp, what);
  const text = await resp.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new VoiceHttpError(`${what} returned something that is not JSON: ${text.slice(0, 200)}`);
  }
}
