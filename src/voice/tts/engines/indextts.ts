import { audioBody, jsonBody, postJson } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * IndexTTS (bilibili's open-source TTS), self-hosted through vLLM-Omni — the production route its
 * README points at (recipes.vllm.ai/IndexTeam/IndexTTS-2.5, read 2026-09-29):
 * `vllm serve IndexTeam/IndexTTS-2.5 --omni --trust-remote-code --port 8092` serves the standard
 * `POST /v1/audio/speech` with `voice` and `speed` (0.5–2, mapped to `duration_factor` = 1/speed),
 * and `POST /v1/audio/voices` uploads a voice.
 *
 * The repository's own `webui.py` is Gradio, whose `/gradio_api/call/gen_single` takes positional
 * arguments that change with every UI edit and differ between v2 and v2.5 — not an API to pin a
 * client to. A Gradio deployment can still be driven from 自定义接口.
 *
 * Voices are zero-shot clones of a reference clip, so there are no presets: the voice is the name
 * the reference was uploaded under, typed in or fetched with 获取音色.
 */
export const indextts: TtsEngine = {
  id: "indextts",
  name: "IndexTTS",
  category: "selfHosted",
  site: { zh: "自部署 · vLLM OpenAI 兼容", en: "Self-hosted · vLLM, OpenAI-compatible" },
  docs: "https://recipes.vllm.ai/IndexTeam/IndexTTS-2.5",
  fields: [
    {
      key: "baseUrl",
      label: { zh: "服务地址", en: "Server URL" },
      kind: "url",
      default: "http://127.0.0.1:8092/v1",
      placeholder: "http://127.0.0.1:8092/v1",
      hint: {
        zh: "vllm serve IndexTeam/IndexTTS-2.5 --omni --port 8092 之后的地址。仓库自带的 Gradio WebUI 不是稳定接口，要用它请走「自定义接口」。",
        en: "Where `vllm serve IndexTeam/IndexTTS-2.5 --omni --port 8092` is listening. The repo's Gradio WebUI is not a stable API — drive it from “Custom endpoint” instead.",
      },
    },
    {
      key: "apiKey",
      label: "API Key",
      kind: "secret",
      optional: true,
      hint: {
        zh: "只有给 vLLM 设了 --api-key 时才需要填。",
        en: "Only needed when vLLM was started with --api-key.",
      },
    },
  ],
  models: ["IndexTeam/IndexTTS-2.5", "IndexTeam/IndexTTS-2"],
  // Zero-shot cloning only: the reference clip is the voice.
  voices: () => [],
  customVoice: true,
  defaultVoice: () => "",
  // speed 0.5–2.0 → duration_factor = 1/speed.
  rate: { min: 0.5, max: 2 },
  async listVoices(config, ctx) {
    const values = fieldValues(indextts, config);
    const base = (values.baseUrl ?? "").replace(/\/+$/, "");
    const json = await jsonBody<{ data?: unknown[]; voices?: unknown[] }>(
      await ctx.fetch(`${base}/audio/voices`, {
        headers: values.apiKey ? { Authorization: `Bearer ${values.apiKey}` } : {},
        signal: ctx.signal,
      }),
      "IndexTTS voices",
    );
    const list = json.voices ?? json.data ?? [];
    return list
      .map((v): TtsVoice | null => {
        if (typeof v === "string") return { id: v, name: v };
        const id = (v as { id?: unknown; name?: unknown }).id ?? (v as { name?: unknown }).name;
        return typeof id === "string" ? { id, name: id } : null;
      })
      .filter((v): v is TtsVoice => v !== null);
  },
  synthesize(input, config, ctx) {
    const values = fieldValues(indextts, config);
    const base = (values.baseUrl ?? "").replace(/\/+$/, "");
    return postJson(
      ctx,
      `${base}/audio/speech`,
      values.apiKey ? { Authorization: `Bearer ${values.apiKey}` } : {},
      {
        model: input.model,
        input: input.text,
        voice: input.voice,
        response_format: "wav",
        speed: input.rate,
      },
    ).then((resp) => audioBody(resp, "IndexTTS"));
  },
};
