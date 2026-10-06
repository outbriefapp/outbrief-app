import { audioBody, jsonBody, postJson } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * xAI Grok TTS `POST /v1/tts` (docs.x.ai/developers/model-capabilities/audio/text-to-speech,
 * checked 2026-09-29): the body is the audio itself, and there is no model field. `language` is
 * required — "auto" is sent when the call language is not one Grok names, so it detects it itself.
 *
 * A voice is not tied to a language: "all voices can speak every supported language", so `voices`
 * is one list whatever the call language is (unlike MiniMax / 豆包 / Azure, whose voices are
 * per language).
 */
const BASE = "https://api.x.ai/v1";

/** The 28 built-in voices; ids are case-insensitive, `eve` is the default. */
const VOICES: TtsVoice[] = [
  "eve",
  "carina",
  "zagan",
  "helix",
  "orion",
  "luna",
  "iris",
  "altair",
  "zenith",
  "perseus",
  "helios",
  "lux",
  "kepler",
  "rigel",
  "cosmo",
  "celeste",
  "ursa",
  "sirius",
  "lumen",
  "castor",
  "naksh",
  "atlas",
  "aurora",
  "liora",
  "ara",
  "leo",
  "rex",
  "sal",
].map((id) => ({ id, name: id[0]?.toUpperCase() + id.slice(1) }));

/** The languages the docs list; anything else is detected by the API ("auto"). */
const LANGUAGES = [
  "en",
  "ar-EG",
  "ar-SA",
  "ar-AE",
  "bn",
  "zh",
  "fr",
  "de",
  "hi",
  "id",
  "it",
  "ja",
  "ko",
  "pt-BR",
  "pt-PT",
  "ru",
  "es-MX",
  "es-ES",
  "tr",
  "vi",
];

/**
 * The call language as Grok's required `language`: the exact tag when it names it, else the same
 * language in whatever region it does name ("es-AR" → "es-MX"), else "auto" so it detects it itself.
 */
export function grokLanguage(language: string): string {
  const wanted = language.toLowerCase();
  const exact = LANGUAGES.find((l) => l.toLowerCase() === wanted);
  if (exact) return exact;
  const base = wanted.split("-")[0] ?? "";
  return LANGUAGES.find((l) => l.toLowerCase().split("-")[0] === base) ?? "auto";
}

export const grok: TtsEngine = {
  id: "grok",
  name: "Grok",
  category: "cloud",
  site: "api.x.ai",
  docs: "https://docs.x.ai/developers/model-capabilities/audio/text-to-speech",
  fields: [{ key: "apiKey", label: "API Key", kind: "secret", placeholder: "xai-…" }],
  // The endpoint takes no model field.
  models: [],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "eve",
  // speed: 0.7–1.5, default 1.0.
  rate: { min: 0.7, max: 1.5 },
  async listVoices(config, ctx) {
    const values = fieldValues(grok, config);
    const json = await jsonBody<{ voices?: { voice_id?: string; name?: string }[] }>(
      await ctx.fetch(`${BASE}/tts/voices`, {
        headers: { Authorization: `Bearer ${values.apiKey}` },
        signal: ctx.signal,
      }),
      "Grok voices",
    );
    return (json.voices ?? [])
      .filter((v): v is { voice_id: string; name?: string } => typeof v.voice_id === "string")
      .map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id }));
  },
  synthesize(input, config, ctx) {
    const values = fieldValues(grok, config);
    return postJson(
      ctx,
      `${BASE}/tts`,
      { Authorization: `Bearer ${values.apiKey}` },
      {
        text: input.text,
        language: grokLanguage(input.language),
        voice_id: input.voice,
        output_format: { codec: "mp3", sample_rate: 24000, bit_rate: 128000 },
        speed: input.rate,
      },
    ).then((resp) => audioBody(resp, "Grok TTS"));
  },
};
