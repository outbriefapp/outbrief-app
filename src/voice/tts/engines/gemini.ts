import { audioFromJson, jsonBody, postJson, toAudioBlob } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * Gemini TTS through `generateContent` (ai.google.dev/gemini-api/docs/generate-content/
 * speech-generation, checked 2026-09-29). The audio comes back base64 in `inlineData`; the 3.8
 * models answer a non-streaming request with a complete WAV, while 3.1 / 2.5 send headerless L16
 * PCM — `AUDIO_WAV` is requested explicitly so every model returns the same thing.
 *
 * The API has no numeric speed, only prompting, so the rate is asked for in `speech_metadata.style`
 * and `rate` stays null: the settings page then says the speed slider does not apply here.
 */
const BASE = "https://generativelanguage.googleapis.com/v1beta";

/** The 30 built-in voices with the style the docs name them by. */
const VOICES: TtsVoice[] = (
  [
    ["Zephyr", "Bright"],
    ["Puck", "Upbeat"],
    ["Charon", "Informative"],
    ["Kore", "Firm"],
    ["Fenrir", "Excitable"],
    ["Leda", "Youthful"],
    ["Orus", "Firm"],
    ["Aoede", "Breezy"],
    ["Callirrhoe", "Easy-going"],
    ["Autonoe", "Bright"],
    ["Enceladus", "Breathy"],
    ["Iapetus", "Clear"],
    ["Umbriel", "Easy-going"],
    ["Algieba", "Smooth"],
    ["Despina", "Smooth"],
    ["Erinome", "Clear"],
    ["Algenib", "Gravelly"],
    ["Rasalgethi", "Informative"],
    ["Laomedeia", "Upbeat"],
    ["Achernar", "Soft"],
    ["Alnilam", "Firm"],
    ["Schedar", "Even"],
    ["Gacrux", "Mature"],
    ["Pulcherrima", "Forward"],
    ["Achird", "Friendly"],
    ["Zubenelgenubi", "Casual"],
    ["Vindemiatrix", "Gentle"],
    ["Sadachbia", "Lively"],
    ["Sadaltager", "Knowledgeable"],
    ["Sulafat", "Warm"],
  ] as const
).map(([id, style]) => ({ id, name: `${id} · ${style}` }));

/** `SpeechConfig.languageCode` only takes these; anything else is left out. */
const LANGUAGE_CODES = new Set([
  "de-DE",
  "en-AU",
  "en-GB",
  "en-IN",
  "en-US",
  "es-US",
  "fr-FR",
  "hi-IN",
  "pt-BR",
  "ar-XA",
  "es-ES",
  "fr-CA",
  "id-ID",
  "it-IT",
  "ja-JP",
  "tr-TR",
  "vi-VN",
  "bn-IN",
  "gu-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "ta-IN",
  "te-IN",
  "nl-NL",
  "ko-KR",
  "cmn-CN",
  "pl-PL",
  "ru-RU",
  "th-TH",
]);

/** Gemini writes Mandarin as "cmn-CN"; other locales pass through when it takes them. */
export function geminiLanguageCode(language: string): string | undefined {
  if (/^zh-(CN|SG)$/i.test(language)) return "cmn-CN";
  return LANGUAGE_CODES.has(language) ? language : undefined;
}

/** The rate as a style instruction, since the API has no speed parameter. */
export function paceStyle(rate: number): string | undefined {
  if (rate >= 1.15) return "speaking rapidly";
  if (rate <= 0.85) return "speaking slowly";
  return undefined;
}

interface GeminiResponse {
  error?: { message?: string; status?: string };
}

export const gemini: TtsEngine = {
  id: "gemini",
  name: "Gemini",
  category: "cloud",
  site: "generativelanguage.googleapis.com",
  docs: "https://ai.google.dev/gemini-api/docs/generate-content/speech-generation",
  fields: [{ key: "apiKey", label: "API Key", kind: "secret", placeholder: "AIza…" }],
  models: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts"],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "Kore",
  // No numeric speed: only prompting (see paceStyle).
  rate: null,
  async listVoices(config, ctx) {
    const values = fieldValues(gemini, config);
    const json = await jsonBody<
      GeminiResponse & { voices?: { id?: string; display_name?: string; description?: string }[] }
    >(
      await ctx.fetch(`${BASE}/voices?page_size=1000`, {
        headers: { "x-goog-api-key": values.apiKey ?? "" },
        signal: ctx.signal,
      }),
      "Gemini voices",
    );
    return (json.voices ?? [])
      .filter((v): v is { id: string; display_name?: string } => typeof v.id === "string")
      .map((v) => ({ id: v.id, name: v.display_name ?? v.id }));
  },
  async synthesize(input, config, ctx) {
    const values = fieldValues(gemini, config);
    const style = paceStyle(input.rate);
    const languageCode = geminiLanguageCode(input.language);
    const json = await jsonBody<GeminiResponse>(
      await postJson(
        ctx,
        `${BASE}/models/${encodeURIComponent(input.model)}:generateContent`,
        { "x-goog-api-key": values.apiKey ?? "" },
        {
          contents: [
            {
              role: "user",
              parts: [{ text: input.text, ...(style ? { speech_metadata: { style } } : {}) }],
            },
          ],
          generationConfig: {
            responseModalities: ["AUDIO"],
            speechConfig: {
              voiceConfig: { voice: input.voice },
              ...(languageCode ? { languageCode } : {}),
            },
            // 3.1 / 2.5 would otherwise answer with headerless L16 PCM.
            responseFormat: { audio: { mimeType: "AUDIO_WAV", sampleRate: 24000 } },
          },
        },
      ),
      "Gemini TTS",
    );
    const bytes = audioFromJson([json], "candidates.0.content.parts.0.inlineData.data", "base64");
    return toAudioBlob(bytes, { kind: "auto" });
  },
};
