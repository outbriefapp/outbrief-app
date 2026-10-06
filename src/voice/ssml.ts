import type { VoiceOptions } from "./voices.ts";

/**
 * Azure SSML rules this builder follows:
 * - `<speak xml:lang>` is the voice's own locale; nesting is strictly voice > lang > prosody > text.
 * - `<lang>` switches pronunciation only on Multilingual / DragonHD voices (plain voices fail silently),
 *   so it is emitted just for those: the call language when it is not the voice's own locale (as
 *   youtube-dubbing-extension's EdgeTtsSsmlBuilder does), else en-US for a clearly English sentence.
 * - DragonHD voices ignore `<prosody>`, so it is skipped for them.
 * - Text is entity-escaped (no CDATA); XML-illegal control characters become spaces.
 */

const MULTILINGUAL_VOICE = /MultilingualNeural(HD)?$|:DragonHD(Omni|Flash)?LatestNeural$/i;
const HD_VOICE = /:DragonHD(Omni|Flash)?LatestNeural$/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point.
const XML_ILLEGAL_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
const LATIN_LETTER = /\p{Script=Latin}/u;
const NO_NON_LATIN_LETTERS = /^[\P{L}\p{Script=Latin}]*$/u;
/** Voice locales written in another script: an all-Latin sentence there is English. */
const NON_LATIN_LOCALE = ["zh", "yue", "wuu", "ja", "ko"];

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Rate multiplier → prosody percentage: 1.2 → "+20%", 0.8 → "-20%" (clamped to 0.5–2). */
export function prosodyRate(rate: number): string {
  const percent = Math.round((Math.min(2, Math.max(0.5, rate)) - 1) * 100);
  return `${percent >= 0 ? "+" : ""}${percent}%`;
}

/** Builds the `cognitiveservices/v1` request body for one sentence. */
export function buildSsml(
  text: string,
  opts: Pick<VoiceOptions, "voice" | "rate" | "language">,
): string {
  const clean = text.replace(XML_ILLEGAL_CONTROL, " ");
  if (!clean.trim()) throw new Error("SSML text is empty");
  const [language, region] = opts.voice.split("-");
  const voiceLocale = language && region ? `${language}-${region}` : "zh-CN";

  let inner = escapeXml(clean);
  if (!HD_VOICE.test(opts.voice)) {
    inner = `<prosody rate="${prosodyRate(opts.rate)}">${inner}</prosody>`;
  }
  const multilingual = MULTILINGUAL_VOICE.test(opts.voice);
  // A Chinese / Japanese / Korean multilingual voice reads an all-Latin sentence with its own
  // accent unless told; for Spanish, French or German voices that sentence is their own language.
  const latinOnly = LATIN_LETTER.test(clean) && NO_NON_LATIN_LETTERS.test(clean);
  if (multilingual && opts.language.toLowerCase() !== voiceLocale.toLowerCase()) {
    inner = `<lang xml:lang="${escapeXml(opts.language)}">${inner}</lang>`;
  } else if (multilingual && latinOnly && NON_LATIN_LOCALE.includes(language ?? "")) {
    inner = `<lang xml:lang="en-US">${inner}</lang>`;
  }
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${escapeXml(voiceLocale)}">` +
    `<voice name="${escapeXml(opts.voice)}">${inner}</voice></speak>`
  );
}
