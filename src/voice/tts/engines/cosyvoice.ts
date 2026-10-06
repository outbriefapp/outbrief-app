import { ensureOk, toAudioBlob } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * CosyVoice, self-hosted, through the official FastAPI server (`runtime/python/fastapi/server.py`,
 * FunAudioLLM/CosyVoice @ 074ca6d, read 2026-09-29): `python3 server.py --port 50000`, form fields,
 * and a body that is **headerless int16 mono PCM** (the response even says `text/plain`), so the
 * sample rate has to be known here — 22050 for CosyVoice 1, 24000 for CosyVoice 2 / 3 — and the WAV
 * header is added on this side.
 *
 * `/inference_sft` needs a model with `spk2info.pt` (CosyVoice-300M-SFT); CosyVoice 2 / 3 have no
 * preset voices, so `/inference_zero_shot` with a reference clip is their route and is not offered
 * here. The server exposes no voice list and no `speed` parameter (both exist underneath but are not
 * passed through), which is why the voice is typed in and `rate` is null.
 */
const VOICES: TtsVoice[] = [
  { id: "中文女", name: { zh: "中文女", en: "Chinese female" }, gender: "female" },
  { id: "中文男", name: { zh: "中文男", en: "Chinese male" }, gender: "male" },
];

export const cosyvoice: TtsEngine = {
  id: "cosyvoice",
  name: "CosyVoice",
  category: "selfHosted",
  site: { zh: "自部署 · 官方 FastAPI", en: "Self-hosted · official FastAPI" },
  docs: "https://github.com/FunAudioLLM/CosyVoice",
  fields: [
    {
      key: "baseUrl",
      label: { zh: "服务地址", en: "Server URL" },
      kind: "url",
      default: "http://127.0.0.1:50000",
      placeholder: "http://127.0.0.1:50000",
      hint: {
        zh: "运行 `python3 server.py --port 50000` 后的地址。",
        en: "Where `python3 server.py --port 50000` is listening.",
      },
    },
    {
      key: "sampleRate",
      label: { zh: "采样率", en: "Sample rate" },
      kind: "select",
      default: "22050",
      options: [
        { value: "22050", label: "22050 Hz · CosyVoice-300M" },
        { value: "24000", label: "24000 Hz · CosyVoice2 / CosyVoice3" },
      ],
      hint: {
        zh: "接口返回裸 PCM、不带采样率，要和服务端跑的模型一致，填错会变速。",
        en: "The API returns headerless PCM; this must match the model the server runs, or the audio plays at the wrong speed.",
      },
    },
  ],
  models: [],
  voices: () => VOICES,
  // Any spk_id in the model's spk2info.pt; the server cannot list them.
  customVoice: true,
  defaultVoice: () => "中文女",
  // server.py passes no speed through to the model.
  rate: null,
  async synthesize(input, config, ctx) {
    const values = fieldValues(cosyvoice, config);
    const base = (values.baseUrl ?? "").replace(/\/+$/, "");
    const form = new FormData();
    form.append("tts_text", input.text);
    form.append("spk_id", input.voice);
    const resp = await ctx.fetch(`${base}/inference_sft`, {
      method: "POST",
      body: form,
      signal: ctx.signal,
    });
    await ensureOk(resp, "CosyVoice");
    const pcm = new Uint8Array(await resp.arrayBuffer());
    const sampleRate = Number(values.sampleRate) || 22050;
    return toAudioBlob(pcm, { kind: "pcm16", sampleRate });
  },
};
