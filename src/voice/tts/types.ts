import type { Locale } from "../../i18n/index.ts";
import type { SpeechLanguage } from "../languages.ts";
import type { HttpTemplate } from "./template.ts";

/** Text shown in the settings page: one string for product words, or one per UI language. */
export type Localized = string | Record<Locale, string>;

export function localized(text: Localized, locale: Locale): string {
  return typeof text === "string" ? text : text[locale];
}

/**
 * One setting a TTS engine needs besides model and voice (API key, region, app id, service
 * address…). The settings page draws these generically, so a new engine needs no UI code.
 */
export interface TtsField {
  key: string;
  label: Localized;
  /** `secret`: masked, shown as "已保存 sk-…abcd" once saved; `url`: an http(s) address. */
  kind: "text" | "secret" | "url" | "select";
  placeholder?: string;
  /** For `select`. */
  options?: readonly { value: string; label: Localized }[];
  /** Used when nothing was entered. */
  default?: string;
  hint?: Localized;
  /** Blank is allowed. */
  optional?: boolean;
}

export interface TtsVoice {
  id: string;
  /** How the picker names it; product names such as "Alloy" are not translated. */
  name: Localized;
  gender?: "female" | "male";
}

/**
 * What the user saved for one engine. `values` holds its `fields`; `request` is the custom
 * engine's HTTP template. Every engine keeps its own config, so switching engines loses nothing.
 */
export interface TtsConfig {
  values: Record<string, string>;
  model: string;
  voice: string;
  request?: HttpTemplate;
}

export const EMPTY_TTS_CONFIG: TtsConfig = { values: {}, model: "", voice: "" };

/** One sentence to speak, with the voice and model already resolved. */
export interface TtsInput {
  text: string;
  voice: string;
  model: string;
  /** Speaking-rate multiplier (1 = normal), already clamped to the engine's `rate` range. */
  rate: number;
  language: SpeechLanguage;
}

export interface TtsContext {
  /** Inside Tauri this goes through Rust: TTS endpoints send no CORS headers to the webview. */
  fetch: typeof fetch;
  signal?: AbortSignal;
}

/**
 * Where an engine's voices come from:
 * - `free`: works without any account (Azure through the translator endpoint);
 * - `cloud`: a vendor's API with the user's own key;
 * - `selfHosted`: an open-source model the user runs, reached at its address;
 * - `custom`: any HTTP API, described by the user as a request template.
 */
export type TtsCategory = "free" | "cloud" | "selfHosted" | "custom";

/**
 * A speech engine. Engines are registered in `registry.ts`; the settings page, the synthesizer
 * and the audio cache only know this interface, so adding one is a new module plus one line there.
 */
export interface TtsEngine {
  id: string;
  /** Product name, not translated. */
  name: string;
  category: TtsCategory;
  /** Shown under the name in the picker, e.g. "api.openai.com" or "自部署". */
  site: Localized;
  docs: string;
  fields: readonly TtsField[];
  /** Model ids, recommended first; the first one is used until the user picks one. Empty: none. */
  models: readonly string[];
  /** Voices for calls in `language`, female first when the engine says. */
  voices(language: SpeechLanguage): readonly TtsVoice[];
  /** Whether a voice id outside `voices` can be typed in (cloned or self-hosted voices). */
  customVoice: boolean;
  /** The voice until the user picks one. */
  defaultVoice(language: SpeechLanguage): string;
  /** The account's own voices (cloned, designed…), when the API can list them. */
  listVoices?(config: TtsConfig, ctx: TtsContext): Promise<TtsVoice[]>;
  /** The speaking-rate multipliers the API takes; null when the rate cannot be set. */
  rate: { min: number; max: number } | null;
  /**
   * true: `synthesize` applies the shared concurrency limit and its own retries (Azure, whose token
   * is shared with speech recognition). Otherwise the synthesizer does both for it.
   */
  ownsRequestPolicy?: boolean;
  /** One sentence as playable audio (mp3, wav, ogg…). Throws `VoiceHttpError` for HTTP errors. */
  synthesize(input: TtsInput, config: TtsConfig, ctx: TtsContext): Promise<Blob>;
}

/** The engine's field values from `config`, trimmed, with its defaults for blanks. */
export function fieldValues(engine: TtsEngine, config: TtsConfig): Record<string, string> {
  const values: Record<string, string> = {};
  for (const f of engine.fields) values[f.key] = config.values[f.key]?.trim() || f.default || "";
  return values;
}
