import { azure } from "./engines/azure.ts";
import { chattts } from "./engines/chattts.ts";
import { cosyvoice } from "./engines/cosyvoice.ts";
import { custom } from "./engines/custom.ts";
import { doubao } from "./engines/doubao.ts";
import { elevenlabs } from "./engines/elevenlabs.ts";
import { gemini } from "./engines/gemini.ts";
import { grok } from "./engines/grok.ts";
import { indextts } from "./engines/indextts.ts";
import { minimax } from "./engines/minimax.ts";
import { openai } from "./engines/openai.ts";
import { qwen } from "./engines/qwen.ts";
import { tencent } from "./engines/tencent.ts";
import type { TtsEngine } from "./types.ts";

/**
 * Every speech engine, in the order the 内置服务商 picker lists them (Azure, free, first). Adding
 * an engine is a module under `engines/` plus a line here; nothing else names engines.
 */
export const TTS_ENGINES: readonly TtsEngine[] = [
  azure,
  elevenlabs,
  minimax,
  doubao,
  qwen,
  tencent,
  openai,
  gemini,
  grok,
  chattts,
  indextts,
  cosyvoice,
  custom,
];

export const DEFAULT_ENGINE = azure.id;

/** The built-in engines: all but 自定义接口. */
export const BUILTIN_ENGINES = TTS_ENGINES.filter((e) => e.category !== "custom");

/** The engine with `id`; Azure for an id no engine has (e.g. one saved by a newer version). */
export function ttsEngine(id: string): TtsEngine {
  return TTS_ENGINES.find((e) => e.id === id) ?? azure;
}

export function isTtsEngine(id: unknown): id is string {
  return TTS_ENGINES.some((e) => e.id === id);
}
