import { VoiceHttpError } from "../errors.ts";
import {
  type AudioFormat,
  audioBody,
  audioFromJson,
  audioFromUrl,
  ensureOk,
  jsonDocuments,
  toAudioBlob,
  valueAt,
} from "./audio.ts";
import type { TtsContext, TtsInput } from "./types.ts";

/**
 * 自定义接口: any TTS HTTP API, described the way Postman does — method, URL, headers, body — with
 * `{{text}}`, `{{voice}}`, `{{speed}}`… where each sentence's values go, plus where the audio is
 * in the response. Nothing is vendor-specific, so APIs this app has never heard of work too.
 */
export const HTTP_METHODS = ["POST", "GET", "PUT"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface HttpHeader {
  name: string;
  value: string;
}

/**
 * Where the audio is in the response:
 * - `body`: the body is the audio file (or headerless PCM);
 * - `json`: a string field at `path` holds it — base64 or hex audio, or a URL to download. Bodies
 *   with one JSON object per line (streaming APIs) are joined in order.
 */
export interface ResponseSpec {
  source: "body" | "json";
  path: string;
  encoding: "base64" | "hex" | "url";
  /** The audio file type, or headerless 16-bit mono PCM (needs its sample rate). */
  format: "auto" | "pcm16";
  sampleRate: number;
}

export interface HttpTemplate {
  method: HttpMethod;
  url: string;
  headers: HttpHeader[];
  body: string;
  response: ResponseSpec;
}

export const TEMPLATE_VARIABLES = [
  "text",
  "voice",
  "speed",
  "language",
  "uuid",
  "timestamp",
] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

export const DEFAULT_RESPONSE: ResponseSpec = {
  source: "body",
  path: "",
  encoding: "base64",
  format: "auto",
  sampleRate: 24_000,
};

/** A new custom request: the shape of the most common TTS API (OpenAI's `/audio/speech`). */
export const EMPTY_TEMPLATE: HttpTemplate = {
  method: "POST",
  url: "",
  headers: [
    { name: "Content-Type", value: "application/json" },
    { name: "Authorization", value: "Bearer " },
  ],
  body: '{\n  "input": "{{text}}",\n  "voice": "{{voice}}",\n  "speed": {{speed}}\n}',
  response: DEFAULT_RESPONSE,
};

/** Each sentence's values for the placeholders. */
export function templateValues(input: TtsInput): Record<TemplateVariable, string> {
  return {
    text: input.text,
    voice: input.voice,
    speed: String(Math.round(input.rate * 100) / 100),
    language: input.language,
    uuid: crypto.randomUUID(),
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
}

type Escape = (value: string) => string;

const VARIABLE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

function fill(template: string, values: Record<string, string>, quote: Escape): string {
  return template.replace(VARIABLE, (whole, name: string) => {
    const value = values[name];
    return value === undefined ? whole : quote(value);
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * How values are escaped in the body, by its Content-Type: inside a JSON string, form-encoded,
 * XML/SSML entities, or as they are for anything else.
 */
function bodyEscape(contentType: string): Escape {
  if (/json/i.test(contentType)) return (v) => JSON.stringify(v).slice(1, -1);
  if (/x-www-form-urlencoded/i.test(contentType)) return encodeURIComponent;
  if (/xml/i.test(contentType)) return escapeXml;
  return (v) => v;
}

export interface RenderedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
}

/** The request for one sentence: placeholders filled in, escaped for where they stand. */
export function renderTemplate(
  template: HttpTemplate,
  values: Record<string, string>,
): RenderedRequest {
  const headers: Record<string, string> = {};
  for (const h of template.headers) {
    const name = h.name.trim();
    if (name) headers[name] = fill(h.value, values, (v) => v);
  }
  const contentType =
    Object.entries(headers).find(([k]) => k.toLowerCase() === "content-type")?.[1] ?? "";
  const hasBody = template.method !== "GET" && template.body.trim() !== "";
  return {
    method: template.method,
    url: fill(template.url.trim(), values, encodeURIComponent),
    headers,
    body: hasBody ? fill(template.body, values, bodyEscape(contentType)) : undefined,
  };
}

/** Why the template cannot be used yet, or null when it can. */
export function templateProblem(template: HttpTemplate): "url" | "text" | "path" | null {
  const url = template.url.trim().replace(VARIABLE, "x");
  if (!/^https?:\/\/[^/]/i.test(url) || !URL.canParse(url)) return "url";
  const all = [template.url, template.body, ...template.headers.map((h) => h.value)].join("\n");
  if (!/\{\{\s*text\s*\}\}/.test(all)) return "text";
  if (template.response.source === "json" && !template.response.path.trim()) return "path";
  return null;
}

function formatOf(spec: ResponseSpec): AudioFormat {
  return spec.format === "pcm16"
    ? { kind: "pcm16", sampleRate: spec.sampleRate }
    : { kind: "auto" };
}

/** Reads the audio out of a response as `spec` describes. */
export async function readTemplateResponse(
  resp: Response,
  spec: ResponseSpec,
  ctx: TtsContext,
): Promise<Blob> {
  const what = "TTS";
  const format = formatOf(spec);
  if (spec.source === "body") return audioBody(resp, what, format);
  await ensureOk(resp, what);
  const docs = jsonDocuments(await resp.text());
  if (spec.encoding === "url") {
    const url = docs.map((d) => valueAt(d, spec.path)).find((v) => typeof v === "string");
    return audioFromUrl(url, ctx, format);
  }
  return toAudioBlob(audioFromJson(docs, spec.path, spec.encoding), format);
}

/** Sends one sentence through the user's template. */
export async function synthesizeWithTemplate(
  template: HttpTemplate,
  input: TtsInput,
  ctx: TtsContext,
): Promise<Blob> {
  const problem = templateProblem(template);
  if (problem) throw new VoiceHttpError(`custom TTS request is incomplete (${problem})`);
  const req = renderTemplate(template, templateValues(input));
  const resp = await ctx.fetch(req.url, {
    method: req.method,
    headers: req.headers,
    body: req.body,
    signal: ctx.signal,
  });
  return readTemplateResponse(resp, template.response, ctx);
}
