import { DEFAULT_RESPONSE, HTTP_METHODS, type HttpMethod, type HttpTemplate } from "./template.ts";

/**
 * 从 cURL 导入: TTS docs give their example as a curl command, so pasting one fills the custom
 * request. Understands the flags those examples use; the output file (`-o`, `--output`) and
 * transport flags are ignored.
 */

/** Splits a shell command line the way bash would: quotes, `$'…'`, backslashes, line continuations. */
export function shellWords(command: string): string[] {
  const words: string[] = [];
  let word: string | null = null;
  const s = command.replace(/\\\r?\n/g, " ");
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string;
    if (/\s/.test(c)) {
      if (word !== null) words.push(word);
      word = null;
      continue;
    }
    word ??= "";
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      if (end < 0) throw new Error("unclosed '");
      word += s.slice(i + 1, end);
      i = end;
    } else if (c === "$" && s[i + 1] === "'") {
      let j = i + 2;
      for (; j < s.length && s[j] !== "'"; j++) {
        if (s[j] === "\\" && j + 1 < s.length) {
          const next = s[++j] as string;
          word += ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[next] ?? next;
        } else {
          word += s[j];
        }
      }
      if (j >= s.length) throw new Error("unclosed $'");
      i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < s.length && s[j] !== '"'; j++) {
        if (s[j] === "\\" && '"\\$`'.includes(s[j + 1] ?? "")) j++;
        word += s[j];
      }
      if (j >= s.length) throw new Error('unclosed "');
      i = j;
    } else if (c === "\\" && i + 1 < s.length) {
      word += s[++i];
    } else {
      word += c;
    }
  }
  if (word !== null) words.push(word);
  return words;
}

const DATA_FLAGS = ["-d", "--data", "--data-raw", "--data-binary", "--data-ascii"];
/** Flags that take a value this import has no use for. */
const IGNORED_WITH_VALUE = [
  "-o",
  "--output",
  "-m",
  "--max-time",
  "--connect-timeout",
  "-A",
  "--user-agent",
  "-e",
  "--referer",
  "-x",
  "--proxy",
  "--retry",
];

/** A curl command as a custom request. Throws with a readable message when it is not one. */
export function parseCurl(command: string): HttpTemplate {
  const words = shellWords(command.trim());
  if (words[0] !== "curl") throw new Error("not a curl command");
  let method: string | null = null;
  let url = "";
  const headers: { name: string; value: string }[] = [];
  const data: string[] = [];
  const setHeader = (name: string, value: string) => {
    const at = headers.findIndex((h) => h.name.toLowerCase() === name.toLowerCase());
    if (at >= 0) headers[at] = { name, value };
    else headers.push({ name, value });
  };
  for (let i = 1; i < words.length; i++) {
    const w = words[i] as string;
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    const flag = eq > 0 ? w.slice(0, eq) : w;
    const value = () => (eq > 0 ? w.slice(eq + 1) : (words[++i] ?? ""));
    if (flag === "-X" || flag === "--request") method = value().toUpperCase();
    else if (w.startsWith("-X") && w.length > 2) method = w.slice(2).toUpperCase();
    else if (flag === "-H" || flag === "--header") {
      const h = value();
      const colon = h.indexOf(":");
      if (colon > 0) setHeader(h.slice(0, colon).trim(), h.slice(colon + 1).trim());
    } else if (DATA_FLAGS.includes(flag) || flag === "--data-urlencode") {
      data.push(value());
    } else if (flag === "--json") {
      data.push(value());
      setHeader("Content-Type", "application/json");
      setHeader("Accept", "application/json");
    } else if (flag === "-u" || flag === "--user") {
      setHeader("Authorization", `Basic ${btoa(value())}`);
    } else if (flag === "--url") url = value();
    else if (IGNORED_WITH_VALUE.includes(flag)) value();
    else if (!w.startsWith("-") && !url) url = w;
  }
  if (!url) throw new Error("the curl command has no URL");
  const body = data.join("&");
  if (body && !headers.some((h) => h.name.toLowerCase() === "content-type")) {
    setHeader("Content-Type", "application/x-www-form-urlencoded");
  }
  const resolved = method ?? (body ? "POST" : "GET");
  if (!HTTP_METHODS.includes(resolved as HttpMethod)) {
    throw new Error(`method ${resolved} is not supported`);
  }
  return {
    method: resolved as HttpMethod,
    url,
    headers,
    body: prettyJson(body),
    response: DEFAULT_RESPONSE,
  };
}

/** JSON bodies are re-indented so they are editable on a phone; anything else is kept as is. */
function prettyJson(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

/**
 * A place in the request that a placeholder can replace: one leaf of the JSON body, one field of a
 * form body, or one query parameter of the URL. Pasting a curl example gives real example values
 * ("你好"), and the settings page turns the one the user picks into `{{text}}` — so nothing has to be
 * typed by hand on a phone.
 */
export interface RequestSlot {
  /** Where it lives: a JSON path ("input", "req_params.text"), a form field, or a query parameter. */
  path: string;
  /** What the example had there, for the picker to show. */
  sample: string;
  kind: "json" | "form" | "query";
}

/** Names TTS APIs give the sentence, most explicit first. */
const TEXT_KEYS = ["text", "input", "tts_text", "content", "ssml", "message", "prompt"];
/** Names they give the voice and the speed. */
const VOICE_KEYS = ["voice", "voice_id", "voiceid", "speaker", "spk_id", "voicetype", "voice_type"];
const SPEED_KEYS = ["speed", "rate", "speech_rate", "speaking_rate", "speed_ratio"];

/**
 * A numeric field's placeholder is written unquoted (`"speed": {{speed}}`) so it renders as a
 * number — which leaves the body invalid JSON until it is rendered. Quoting those tokens back makes
 * it parseable again, for reading and editing the template.
 */
function parsableJson(body: string): string {
  return body.replace(/(?<!")(\{\{\s*\w+\s*\}\})(?!")/g, '"$1"');
}

function leafSlots(value: unknown, prefix: string, out: RequestSlot[]): void {
  if (value === null || typeof value !== "object") {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      if (prefix) out.push({ path: prefix, sample: String(value), kind: "json" });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      leafSlots(item, prefix ? `${prefix}.${i}` : String(i), out);
    }
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    leafSlots(item, prefix ? `${prefix}.${key}` : key, out);
  }
}

/** Every value of `template` a placeholder could stand in for. */
export function requestSlots(template: HttpTemplate): RequestSlot[] {
  const slots: RequestSlot[] = [];
  const body = template.body.trim();
  if (body) {
    try {
      leafSlots(JSON.parse(parsableJson(body)), "", slots);
    } catch {
      // A form body, or anything else written as key=value pairs.
      for (const pair of body.split("&")) {
        const eq = pair.indexOf("=");
        if (eq > 0) {
          slots.push({
            path: decodeURIComponent(pair.slice(0, eq)),
            sample: decodeURIComponent(pair.slice(eq + 1)),
            kind: "form",
          });
        }
      }
    }
  }
  const url = template.url.trim();
  if (URL.canParse(url)) {
    for (const [key, value] of new URL(url).searchParams) {
      slots.push({ path: key, sample: value, kind: "query" });
    }
  }
  return slots;
}

/** The slot whose name is one of `names` (or whose name ends with one), deepest name match first. */
function slotFor(slots: RequestSlot[], names: readonly string[]): RequestSlot | undefined {
  for (const name of names) {
    const found = slots.find((s) => {
      const leaf = (s.path.split(".").pop() ?? "").toLowerCase();
      return leaf === name;
    });
    if (found) return found;
  }
  return undefined;
}

function setJsonLeaf(body: string, path: string, token: string): string {
  const keys = path.split(".");
  const root = JSON.parse(parsableJson(body)) as unknown;
  let node: Record<string, unknown> | unknown[] = root as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) {
    node = (node as Record<string, unknown>)[key] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1] as string;
  const numeric = /^(speed|rate|speech_rate|speaking_rate|speed_ratio)$/i.test(last);
  // A numeric field must stay unquoted, so the placeholder is written raw and re-quoted below.
  (node as Record<string, unknown>)[last] = numeric ? `__RAW__${token}__RAW__` : token;
  return JSON.stringify(root, null, 2).replace(/"__RAW__(.+?)__RAW__"/g, "$1");
}

/** Replaces the value at `slot` with `token`, leaving the rest of the request as it was. */
export function putPlaceholder(
  template: HttpTemplate,
  slot: RequestSlot,
  token: string,
): HttpTemplate {
  if (slot.kind === "json") {
    try {
      return { ...template, body: setJsonLeaf(template.body, slot.path, token) };
    } catch {
      return template;
    }
  }
  if (slot.kind === "form") {
    const body = template.body
      .split("&")
      .map((pair) => {
        const eq = pair.indexOf("=");
        return eq > 0 && decodeURIComponent(pair.slice(0, eq)) === slot.path
          ? `${pair.slice(0, eq)}=${token}`
          : pair;
      })
      .join("&");
    return { ...template, body };
  }
  if (!URL.canParse(template.url)) return template;
  const url = new URL(template.url);
  url.searchParams.set(slot.path, token);
  // The braces must survive as braces for the renderer to see the placeholder.
  return {
    ...template,
    url: url
      .toString()
      .replace(/%7B%7B/g, "{{")
      .replace(/%7D%7D/g, "}}"),
  };
}

/**
 * An imported curl example with its sentence, voice and speed already turned into placeholders,
 * guessed from the field names each API uses. The user only confirms (or re-picks) the sentence.
 */
export function withGuessedPlaceholders(template: HttpTemplate): HttpTemplate {
  let next = template;
  const guess = (names: readonly string[], token: string) => {
    const slot = slotFor(requestSlots(next), names);
    if (slot) next = putPlaceholder(next, slot, token);
  };
  guess(TEXT_KEYS, "{{text}}");
  guess(VOICE_KEYS, "{{voice}}");
  guess(SPEED_KEYS, "{{speed}}");
  return next;
}
