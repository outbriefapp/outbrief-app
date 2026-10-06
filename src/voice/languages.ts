import type { Locale } from "../i18n/index.ts";
import { AZURE_LANGUAGES } from "./azureVoices.ts";
import { PHRASES } from "./phrases.ts";

/**
 * The language calls are in (设置 → 语音 → 汇报语言), a BCP 47 locale such as "zh-CN" or "es-MX":
 * the local outbrief-daemon writes briefs in it, the voice speaks it and in-call answers use it.
 * The choices are the voice type's languages — Azure, the only type, offers the target languages
 * of youtube-dubbing-extension that have Azure voices (`AZURE_LANGUAGES`).
 */
export type SpeechLanguage = string;

/** What settings store: a fixed language, or whatever the system uses. */
export type SpeechLanguagePref = "system" | SpeechLanguage;

export const SPEECH_LANGUAGES: SpeechLanguage[] = Object.keys(AZURE_LANGUAGES);

export const DEFAULT_SPEECH_LANGUAGE: SpeechLanguage = "en-US";

export function isSpeechLanguage(value: unknown): value is SpeechLanguage {
  return typeof value === "string" && Object.hasOwn(AZURE_LANGUAGES, value);
}

export function isSpeechLanguagePref(value: unknown): value is SpeechLanguagePref {
  return value === "system" || isSpeechLanguage(value);
}

/** The picker's label, as the plugin names it ("美国(英语)", "United States (English)"). */
export function speechLanguageName(language: SpeechLanguage, ui: Locale): string {
  return AZURE_LANGUAGES[language]?.name[ui] ?? language;
}

/** The language for prompts to the LLM, e.g. "墨西哥西班牙语", "中文（繁体，台湾）". */
export function speechLanguagePromptName(language: SpeechLanguage): string {
  const names = new Intl.DisplayNames(["zh"], { type: "language" });
  // The script tells Traditional from Simplified Chinese; other languages read better without it.
  const tag = language.startsWith("zh-")
    ? new Intl.Locale(language).maximize().toString()
    : language;
  return names.of(tag) ?? language;
}

/** `PHRASES` of the language: Traditional Chinese by script, the rest by language subtag. */
function phrases(language: SpeechLanguage): { preview: string; degraded: string } {
  const locale = new Intl.Locale(language);
  const key = locale.language === "zh" ? `zh-${locale.maximize().script}` : locale.language;
  const found = PHRASES[key] ?? PHRASES[locale.language];
  if (!found) throw new Error(`no phrases for ${language}`);
  return found;
}

/** Spoken when a call has no brief (the raw report is on screen). */
export function degradedSpeech(language: SpeechLanguage): string {
  return phrases(language).degraded;
}

/** 设置 → 语音 → 试听. */
export function previewText(language: SpeechLanguage): string {
  return phrases(language).preview;
}

/**
 * The system's language for calls: the first preferred language that is offered as it is (its
 * language and region, "zh-Hans-CN" → "zh-CN"), or in the region it is most spoken in ("pt" →
 * "pt-BR", "zh-Hant" → "zh-TW"); en-US when none is offered.
 */
export function systemSpeechLanguage(
  languages: readonly string[] = navigator.languages,
): SpeechLanguage {
  for (const tag of languages) {
    let locale: Intl.Locale;
    try {
      locale = new Intl.Locale(tag);
    } catch {
      continue;
    }
    const likely = locale.maximize();
    for (const region of [locale.region, likely.region]) {
      const candidate = region && `${locale.language}-${region}`;
      if (candidate && isSpeechLanguage(candidate)) return candidate;
    }
  }
  return DEFAULT_SPEECH_LANGUAGE;
}

export function resolveSpeechLanguage(
  pref: SpeechLanguagePref,
  system: () => SpeechLanguage = systemSpeechLanguage,
): SpeechLanguage {
  return pref === "system" ? system() : pref;
}

/** Resuming playback without asking the LLM, compared after `bare` and lower-casing. */
export const CONTINUE_COMMANDS: readonly string[] = [
  "继续",
  "继续吧",
  "接着说",
  "继续播放",
  "continue",
  "goon",
  "keepgoing",
  "resume",
  "続けて",
  "계속",
  "weiter",
  "sigue",
  "continúa",
];
