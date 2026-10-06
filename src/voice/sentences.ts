/** Fragments shorter than this are merged into a neighbour (one TTS request per "好的。" is wasteful). */
const MIN_CHARS = 6;
/** Longer sentences are split at commas so the first audio starts quickly. */
const MAX_CHARS = 120;
const CJK_TERMINATORS = "。！？；…";
const ASCII_TERMINATORS = ".!?;";
const CLOSERS = "\"'”’」』）)]】》";
/** After a clause comma, but not the thousands separator in "1,000". */
const CLAUSE_BREAK = /(?<=[，、])|(?<=,)(?!\d)/;

interface Cut {
  sentences: string[];
  rest: string;
}

/**
 * Cuts `text` after terminator runs (plus closing quotes/brackets) and at newlines. ASCII
 * terminators only count when followed by whitespace, a non-ASCII character or the end, so "3.5",
 * "a.ts" and "e.g.," stay intact. Unless `final`, a terminator at the very end stays in `rest`
 * because the next chunk may extend the run ("？！", "……", "。」") or continue a number.
 */
function cut(text: string, final: boolean): Cut {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "\n") {
      sentences.push(text.slice(start, i));
      start = i + 1;
      continue;
    }
    if (!CJK_TERMINATORS.includes(ch) && !ASCII_TERMINATORS.includes(ch)) continue;
    let end = i + 1;
    let cjk = CJK_TERMINATORS.includes(ch);
    for (; end < text.length; end++) {
      const next = text[end] ?? "";
      if (CJK_TERMINATORS.includes(next)) cjk = true;
      else if (!ASCII_TERMINATORS.includes(next)) break;
    }
    while (end < text.length && CLOSERS.includes(text[end] ?? "")) end++;
    if (end === text.length && !final) break;
    const next = text.charCodeAt(end);
    const continues = !cjk && end < text.length && next < 0x80 && !/\s/.test(text[end] ?? "");
    i = end - 1;
    if (continues) continue;
    sentences.push(text.slice(start, end));
    start = end;
  }
  return { sentences, rest: text.slice(start) };
}

/** Splits an over-long sentence at clause commas, packing clauses greedily up to MAX_CHARS. */
function splitLong(sentence: string): string[] {
  if (sentence.length <= MAX_CHARS) return [sentence];
  const pieces: string[] = [];
  let current = "";
  for (const clause of sentence.split(CLAUSE_BREAK)) {
    if (current && current.length + clause.length > MAX_CHARS) {
      pieces.push(current);
      current = "";
    }
    current += clause;
    while (current.length > MAX_CHARS) {
      pieces.push(current.slice(0, MAX_CHARS));
      current = current.slice(MAX_CHARS);
    }
  }
  if (current) pieces.push(current);
  return pieces.map((p) => p.trim()).filter(Boolean);
}

/** Concatenates two trimmed fragments, restoring the space English needs between sentences. */
function join(a: string, b: string): string {
  return /[\x21-\x7e]$/.test(a) && /^[A-Za-z0-9]/.test(b) ? `${a} ${b}` : a + b;
}

/**
 * Trims, splits long sentences and merges short fragments into the following one. A short tail is
 * merged backwards when `final`, otherwise returned as `carry` to wait for more text.
 */
function normalize(raw: string[], final: boolean): { sentences: string[]; carry: string } {
  const sentences: string[] = [];
  let carry = "";
  for (const piece of raw.flatMap((s) => splitLong(s.trim())).filter(Boolean)) {
    const merged = carry ? join(carry, piece) : piece;
    if (merged.length < MIN_CHARS) carry = merged;
    else {
      sentences.push(merged);
      carry = "";
    }
  }
  const last = sentences.length - 1;
  if (final && carry && last >= 0) {
    sentences[last] = join(sentences[last] ?? "", carry);
    carry = "";
  }
  if (final && carry) sentences.push(carry);
  return { sentences, carry: final ? "" : carry };
}

/** Split spoken text into TTS-sized sentences (Chinese + English punctuation, keeps punctuation, merges tiny fragments, splits very long ones at commas). */
export function splitSentences(text: string): string[] {
  const { sentences, rest } = cut(text, true);
  return normalize([...sentences, rest], true).sentences;
}

/** Streaming variant for LLM answers: feed chunks, get completed sentences; flush() returns the remainder. */
export class SentenceChunker {
  #buffer = "";

  push(chunk: string): string[] {
    const { sentences, rest } = cut(this.#buffer + chunk, false);
    const pieces = [...sentences];
    let pending = rest;
    // A long clause-comma run without a terminator is spoken in pieces instead of waiting.
    if (pending.length > MAX_CHARS) {
      const long = splitLong(pending);
      pending = long.pop() ?? "";
      pieces.push(...long);
    }
    const { sentences: ready, carry } = normalize(pieces, false);
    // The newline makes the next cut yield the carried fragment again, ready to merge forward.
    this.#buffer = carry ? `${carry}\n${pending}` : pending;
    return ready;
  }

  flush(): string[] {
    const { sentences, rest } = cut(this.#buffer, true);
    this.#buffer = "";
    return normalize([...sentences, rest], true).sentences;
  }
}
