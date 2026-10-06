import { useSyncExternalStore } from "react";
import { en } from "./en.ts";
import { type Messages, zh } from "./zh.ts";

export type { Messages } from "./zh.ts";

/** The languages the UI is written in. */
export type Locale = "zh" | "en";

/** What 设置 → 语言 stores: a fixed language, or whatever the system uses. */
export type LanguagePref = "system" | Locale;

export const LANGUAGE_PREFS: LanguagePref[] = ["system", "zh", "en"];

const CATALOGS: Record<Locale, Messages> = { zh, en };

export function isLanguagePref(value: unknown): value is LanguagePref {
  return LANGUAGE_PREFS.includes(value as LanguagePref);
}

/** Chinese when the system's first language is any Chinese; English for everything else. */
export function systemLocale(languages: readonly string[] = navigator.languages): Locale {
  return languages[0]?.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function resolveLocale(pref: LanguagePref, system: () => Locale = systemLocale): Locale {
  return pref === "system" ? system() : pref;
}

// Chinese until the app sets the user's language on start (and in tests).
let locale: Locale = "zh";
const listeners = new Set<() => void>();

export function currentLocale(): Locale {
  return locale;
}

export function setLocale(next: Locale): void {
  if (next === locale) return;
  locale = next;
  for (const listener of listeners) listener();
}

/** The texts of the current language, for code outside React (errors, labels built in helpers). */
export function t(): Messages {
  return CATALOGS[locale];
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The texts of the current language; the component re-renders when the language changes. */
export function useT(): Messages {
  return CATALOGS[useSyncExternalStore(subscribe, currentLocale)];
}
