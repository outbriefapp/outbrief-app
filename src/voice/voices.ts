import { AZURE_LANGUAGES, AZURE_VOICE_NAMES } from "./azureVoices.ts";
import type { SpeechLanguage } from "./languages.ts";

import type { TtsConfig } from "./tts/types.ts";

/**
 * One synthesis: the engine (设置 → 语音) and its saved settings, the voice already resolved for
 * the call language, the speaking-rate multiplier (1 = normal) and the call language.
 */
export interface VoiceOptions {
  /** A `TtsEngine` id from `tts/registry.ts`. */
  engine: string;
  config: TtsConfig;
  voice: string;
  rate: number;
  language: SpeechLanguage;
}

/** Azure's default voice (the free engine). */
export const DEFAULT_VOICE = "zh-CN-XiaoxiaoMultilingualNeural";

export interface VoiceGroup {
  gender: "female" | "male";
  voices: { id: string; label: string }[];
}

/**
 * A voice's name in the picker, as the plugin shows it: its own-language name when it belongs to
 * the call language ("晓晓 多语言"), else its English name ("Ava Multilingual").
 */
export function voiceLabel(id: string, language: SpeechLanguage): string {
  const names = AZURE_VOICE_NAMES[id];
  if (!names) return id;
  return names.locale === language ? names.local : names.display;
}

/** The picker's groups for calls in `language`: female, then male voices. */
export function voiceGroupsOf(language: SpeechLanguage): VoiceGroup[] {
  const entry = AZURE_LANGUAGES[language];
  if (!entry) return [];
  return (["female", "male"] as const)
    .map((gender) => ({
      gender,
      voices: entry[gender].map((id) => ({ id, label: voiceLabel(id, language) })),
    }))
    .filter((g) => g.voices.length > 0);
}

/** Whether `id` is offered for calls in `language`. */
export function speaksLanguage(id: string, language: SpeechLanguage): boolean {
  const entry = AZURE_LANGUAGES[language];
  return !!entry && (entry.female.includes(id) || entry.male.includes(id));
}

/** The language's voice until the user picks one: its first female voice (else male). */
export function defaultVoice(language: SpeechLanguage): string {
  const entry = AZURE_LANGUAGES[language];
  const id = entry?.female[0] ?? entry?.male[0];
  if (!id) throw new Error(`no voices for ${language}`);
  return id;
}

/**
 * The voice calls in `language` are spoken with: the saved voice when it is offered for that
 * language, else the language's default. The saved one is kept, so switching back restores it.
 */
export function speechVoice(saved: string, language: SpeechLanguage): string {
  return speaksLanguage(saved, language) ? saved : defaultVoice(language);
}
