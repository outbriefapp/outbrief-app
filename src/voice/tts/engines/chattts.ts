import { audioBody, postJson } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * ChatTTS, self-hosted, through the OpenAI-compatible example server
 * (`examples/api/openai_api.py`, 2noise/ChatTTS @ 77b89ee, read 2026-09-29):
 * `fastapi dev examples/api/openai_api.py --port 8000` → `POST /v1/audio/speech`, which answers
 * with the audio file (mp3 / wav / ogg, 24 kHz mono).
 *
 * That server takes only its three voices (their `.pt` speaker files must be next to it), rewrites
 * `model` to "tts-1" and — this is in its source, not a guess — has the `speed` → `[speed_N]`
 * mapping commented out and `[speed_5]` hardcoded, so the rate cannot be set. The native
 * `/generate_voice` endpoint answers with a zip, which is why this one is used.
 */
const VOICES: TtsVoice[] = [
  { id: "default", name: { zh: "默认（1528.pt）", en: "Default (1528.pt)" } },
  { id: "alloy", name: "Alloy (1384.pt)" },
  { id: "echo", name: "Echo (2443.pt)" },
];

export const chattts: TtsEngine = {
  id: "chattts",
  name: "ChatTTS",
  category: "selfHosted",
  site: { zh: "自部署 · OpenAI 兼容接口", en: "Self-hosted · OpenAI-compatible" },
  docs: "https://github.com/2noise/ChatTTS/blob/main/examples/api/README.md",
  fields: [
    {
      key: "baseUrl",
      label: { zh: "服务地址", en: "Server URL" },
      kind: "url",
      default: "http://127.0.0.1:8000",
      placeholder: "http://127.0.0.1:8000",
      hint: {
        zh: "运行 `fastapi dev examples/api/openai_api.py --port 8000` 后的地址。",
        en: "Where `fastapi dev examples/api/openai_api.py --port 8000` is listening.",
      },
    },
  ],
  models: [],
  voices: () => VOICES,
  customVoice: false,
  defaultVoice: () => "default",
  // The example server hardcodes [speed_5]; `speed` passes validation but does nothing.
  rate: null,
  synthesize(input, config, ctx) {
    const values = fieldValues(chattts, config);
    const base = (values.baseUrl ?? "").replace(/\/+$/, "");
    return postJson(
      ctx,
      `${base}/v1/audio/speech`,
      {},
      // `model` is rewritten to "tts-1" server-side, but the field is required.
      { model: "tts-1", input: input.text, voice: input.voice, response_format: "mp3" },
    ).then((resp) => audioBody(resp, "ChatTTS"));
  },
};
