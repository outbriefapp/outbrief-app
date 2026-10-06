import type { SpeechLanguage } from "../languages.ts";
import type { VoiceOptions } from "../voices.ts";
import { DEFAULT_ENGINE, isTtsEngine, ttsEngine } from "./registry.ts";
import {
  DEFAULT_RESPONSE,
  HTTP_METHODS,
  type HttpMethod,
  type HttpTemplate,
  templateProblem,
} from "./template.ts";
import { EMPTY_TTS_CONFIG, fieldValues, type TtsConfig, type TtsEngine } from "./types.ts";

/**
 * 设置 → 语音: the engine calls are spoken with, and what the user saved for each engine (so
 * switching back and forth keeps keys and voices). Stays on this device.
 */
export interface TtsSettings {
  engine: string;
  configs: Record<string, TtsConfig>;
}

export const DEFAULT_TTS: TtsSettings = { engine: DEFAULT_ENGINE, configs: {} };

function strings(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

function normalizeTemplate(value: unknown): HttpTemplate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Partial<HttpTemplate>;
  const r: Partial<HttpTemplate["response"]> = v.response ?? {};
  return {
    method: HTTP_METHODS.includes(v.method as HttpMethod) ? (v.method as HttpMethod) : "POST",
    url: typeof v.url === "string" ? v.url : "",
    headers: Array.isArray(v.headers)
      ? v.headers
          .filter((h) => h && typeof h.name === "string" && typeof h.value === "string")
          .map((h) => ({ name: h.name, value: h.value }))
      : [],
    body: typeof v.body === "string" ? v.body : "",
    response: {
      source: r.source === "json" ? "json" : "body",
      path: typeof r.path === "string" ? r.path : "",
      encoding: r.encoding === "hex" || r.encoding === "url" ? r.encoding : "base64",
      format: r.format === "pcm16" ? "pcm16" : "auto",
      sampleRate:
        typeof r.sampleRate === "number" && r.sampleRate > 0
          ? r.sampleRate
          : DEFAULT_RESPONSE.sampleRate,
    },
  };
}

function normalizeConfig(value: unknown): TtsConfig {
  if (!value || typeof value !== "object") return EMPTY_TTS_CONFIG;
  const v = value as Partial<Record<keyof TtsConfig, unknown>>;
  const request = normalizeTemplate(v.request);
  return {
    values: strings(v.values),
    model: typeof v.model === "string" ? v.model : "",
    voice: typeof v.voice === "string" ? v.voice : "",
    ...(request ? { request } : {}),
  };
}

/**
 * Saved TTS settings, or the defaults. Versions before engines saved only an Azure voice
 * (`legacyVoice`); it becomes Azure's.
 */
export function normalizeTts(stored: unknown, legacyVoice?: string): TtsSettings {
  const s = (stored && typeof stored === "object" ? stored : {}) as Partial<
    Record<keyof TtsSettings, unknown>
  >;
  const configs: Record<string, TtsConfig> = {};
  if (s.configs && typeof s.configs === "object") {
    for (const [id, config] of Object.entries(s.configs)) configs[id] = normalizeConfig(config);
  }
  if (legacyVoice && !configs[DEFAULT_ENGINE]) {
    configs[DEFAULT_ENGINE] = { ...EMPTY_TTS_CONFIG, voice: legacyVoice };
  }
  return { engine: isTtsEngine(s.engine) ? s.engine : DEFAULT_ENGINE, configs };
}

export function configOf(tts: TtsSettings, engineId: string): TtsConfig {
  return tts.configs[engineId] ?? EMPTY_TTS_CONFIG;
}

/**
 * The voice calls in `language` are spoken with: the saved one when the engine offers it for that
 * language (or takes any id), else the engine's default for the language. The saved one is kept,
 * so switching the language back restores it.
 */
export function voiceFor(engine: TtsEngine, config: TtsConfig, language: SpeechLanguage): string {
  const saved = config.voice.trim();
  if (saved && (engine.customVoice || engine.voices(language).some((v) => v.id === saved))) {
    return saved;
  }
  return engine.defaultVoice(language);
}

/**
 * What still has to be filled in before the engine can speak: the key of a required field, or
 * "voice" / "request" for a custom engine. Null when it is ready.
 */
export function missingSetting(engine: TtsEngine, config: TtsConfig): string | null {
  const values = fieldValues(engine, config);
  const field = engine.fields.find((f) => !f.optional && !values[f.key]);
  if (field) return field.key;
  if (engine.category === "custom") {
    if (!config.request || templateProblem(config.request)) return "request";
  }
  return null;
}

/** Everything a synthesis needs, from the saved settings. */
export function voiceOptions(
  tts: TtsSettings,
  rate: number,
  language: SpeechLanguage,
): VoiceOptions {
  const engine = ttsEngine(tts.engine);
  const config = configOf(tts, engine.id);
  return { engine: engine.id, config, voice: voiceFor(engine, config, language), rate, language };
}
