import { VoiceHttpError } from "../../errors.ts";
import type { SpeechLanguage } from "../../languages.ts";
import { hexToBytes, jsonBody, postJson, toAudioBlob } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";
import { MINIMAX_LEGACY_ZH, MINIMAX_VOICES } from "./minimaxVoices.ts";

/**
 * MiniMax T2A v2, synchronous HTTP (platform.minimax.cn/docs/api-reference/speech-t2a-http,
 * checked 2026-09-29). The China and international sites have separate accounts and keys.
 * Errors come back as HTTP 200 with a non-zero `base_resp.status_code`; the audio is hex.
 */
const SITES: Record<string, string> = {
  cn: "https://api.minimax.cn",
  intl: "https://api.minimax.io",
};

interface MinimaxResponse {
  data?: { audio?: string } | null;
  base_resp?: { status_code?: number; status_msg?: string };
}

function checkBase(json: MinimaxResponse, what: string): void {
  const code = json.base_resp?.status_code ?? 0;
  if (code !== 0) {
    // 1002 / 1039 / 1041 / 2045 are rate limits: worth a retry like HTTP 429.
    const status = [1002, 1039, 1041, 2045].includes(code) ? 429 : 400;
    throw new VoiceHttpError(`${what} ${code}: ${json.base_resp?.status_msg ?? ""}`, status);
  }
}

/**
 * The system voices for calls in `language`: MiniMax's ids name the language they speak, so a
 * Japanese call gets its Japanese voices rather than one global list. Mandarin also keeps the older
 * short ids. Falls back to English, then Mandarin, for a language MiniMax has no system voice for
 * (a cloned voice id can still be typed in).
 */
function voicesFor(language: SpeechLanguage): TtsVoice[] {
  const base = language.split("-")[0]?.toLowerCase() ?? "";
  // MiniMax groups Cantonese separately; the app writes it as yue-* or zh-HK.
  const key = base === "yue" || /^zh-hk$/i.test(language) ? "yue" : base;
  const own = MINIMAX_VOICES[key] ?? [];
  const legacy = key === "zh" ? MINIMAX_LEGACY_ZH : [];
  const found = [...own, ...legacy];
  if (found.length > 0) return found;
  return [...(MINIMAX_VOICES.en ?? []), ...(MINIMAX_VOICES.zh ?? [])];
}

/**
 * The voice a language starts with: a named one for the languages MiniMax documents best, else the
 * first of that language's list (alphabetical, so not otherwise meaningful).
 */
const PREFERRED: Record<string, string> = {
  zh: "female-shaonv",
  en: "English_Graceful_Lady",
  yue: "Cantonese_GentleLady",
  ja: "Japanese_CalmLady",
  ko: "Korean_CalmLady",
};

function defaultVoiceFor(language: SpeechLanguage): string {
  const offered = voicesFor(language);
  const base = language.split("-")[0]?.toLowerCase() ?? "";
  const preferred = PREFERRED[base === "yue" || /^zh-hk$/i.test(language) ? "yue" : base];
  if (preferred && offered.some((v) => v.id === preferred)) return preferred;
  return offered[0]?.id ?? "female-shaonv";
}

const DEFAULT_SITE = "https://api.minimax.cn";

function baseUrl(values: Record<string, string>): string {
  return SITES[values.site ?? "cn"] ?? DEFAULT_SITE;
}

export const minimax: TtsEngine = {
  id: "minimax",
  name: "MiniMax",
  category: "cloud",
  site: "api.minimax.cn · api.minimax.io",
  docs: "https://platform.minimax.cn/docs/api-reference/speech-t2a-http",
  fields: [
    {
      key: "site",
      label: { zh: "站点", en: "Site" },
      kind: "select",
      default: "cn",
      options: [
        { value: "cn", label: { zh: "国内站 api.minimax.cn", en: "China · api.minimax.cn" } },
        {
          value: "intl",
          label: { zh: "国际站 api.minimax.io", en: "International · api.minimax.io" },
        },
      ],
      hint: {
        zh: "两个站点的账号和 Key 不通用。",
        en: "The two sites have separate accounts and keys.",
      },
    },
    { key: "apiKey", label: "API Key", kind: "secret", placeholder: "eyJ…" },
  ],
  models: ["speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo"],
  voices: voicesFor,
  customVoice: true,
  defaultVoice: defaultVoiceFor,
  async listVoices(config, ctx) {
    const values = fieldValues(minimax, config);
    const json = await jsonBody<
      MinimaxResponse & {
        system_voice?: { voice_id: string; voice_name?: string }[];
        voice_cloning?: { voice_id: string; voice_name?: string }[];
        voice_generation?: { voice_id: string; voice_name?: string }[];
      }
    >(
      await postJson(
        ctx,
        `${baseUrl(values)}/v1/get_voice`,
        { Authorization: `Bearer ${values.apiKey}` },
        { voice_type: "all" },
      ),
      "MiniMax get_voice",
    );
    checkBase(json, "MiniMax get_voice");
    return [
      ...(json.voice_cloning ?? []),
      ...(json.voice_generation ?? []),
      ...(json.system_voice ?? []),
    ].map((v) => ({ id: v.voice_id, name: v.voice_name ?? v.voice_id }));
  },
  // voice_setting.speed: [0.5, 2], default 1.
  rate: { min: 0.5, max: 2 },
  async synthesize(input, config, ctx) {
    const values = fieldValues(minimax, config);
    const json = await jsonBody<MinimaxResponse>(
      await postJson(
        ctx,
        `${baseUrl(values)}/v1/t2a_v2`,
        { Authorization: `Bearer ${values.apiKey}` },
        {
          model: input.model,
          text: input.text,
          stream: false,
          voice_setting: { voice_id: input.voice, speed: input.rate, vol: 1, pitch: 0 },
          audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
          language_boost: "auto",
          output_format: "hex",
        },
      ),
      "MiniMax TTS",
    );
    checkBase(json, "MiniMax TTS");
    const audio = json.data?.audio;
    if (!audio) throw new VoiceHttpError("MiniMax TTS returned no audio");
    return toAudioBlob(hexToBytes(audio), { kind: "auto" });
  },
};
