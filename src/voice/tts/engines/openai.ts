import { audioBody, postJson } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * OpenAI `/v1/audio/speech` (developers.openai.com/api/docs/guides/text-to-speech, checked
 * 2026-09-29): the body is the audio itself. A voice is not tied to a language — the docs say the
 * voices are "optimized for English" yet read every language the model knows, and there is no
 * language parameter — so `voices` is one list whatever the call language is (unlike MiniMax /
 * 豆包 / Azure, whose voices are per language).
 */
const VOICES: TtsVoice[] = [
  // The guide recommends marin and cedar as the best quality; the rest also work with tts-1.
  "marin",
  "cedar",
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "nova",
  "onyx",
  "sage",
  "shimmer",
  "verse",
].map((id) => ({ id, name: id[0]?.toUpperCase() + id.slice(1) }));

export const openai: TtsEngine = {
  id: "openai",
  name: "OpenAI",
  category: "cloud",
  site: "api.openai.com",
  docs: "https://developers.openai.com/api/docs/guides/text-to-speech",
  fields: [
    {
      key: "baseUrl",
      label: { zh: "接口地址", en: "Base URL" },
      kind: "url",
      default: "https://api.openai.com/v1",
      hint: {
        zh: "用代理或兼容服务时改这里。",
        en: "Change this for a proxy or a compatible service.",
      },
    },
    { key: "apiKey", label: "API Key", kind: "secret", placeholder: "sk-…" },
  ],
  models: ["gpt-4o-mini-tts", "tts-1-hd", "tts-1"],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "marin",
  // speed: 0.25–4.0, default 1.0.
  rate: { min: 0.5, max: 2 },
  synthesize(input, config, ctx) {
    const values = fieldValues(openai, config);
    const base = (values.baseUrl ?? "").replace(/\/+$/, "");
    return postJson(
      ctx,
      `${base}/audio/speech`,
      { Authorization: `Bearer ${values.apiKey}` },
      {
        model: input.model,
        input: input.text,
        voice: input.voice,
        response_format: "mp3",
        speed: input.rate,
      },
    ).then((resp) => audioBody(resp, "OpenAI TTS"));
  },
};
