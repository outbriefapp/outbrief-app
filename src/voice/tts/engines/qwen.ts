import { VoiceHttpError } from "../../errors.ts";
import { audioFromUrl, base64ToBytes, jsonBody, postJson, toAudioBlob, valueAt } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * 阿里云百炼 Qwen3-TTS over plain HTTP (help.aliyun.com/zh/model-studio/qwen-tts-api, checked
 * 2026-09-29). The recommended API-key-only route: a fixed domain (CosyVoice's HTTP endpoint needs
 * a per-workspace one), 48 system voices and 8 Chinese dialects.
 *
 * A non-streaming response carries `output.audio.url` (valid 24 h), which is downloaded here; the
 * documented `output.audio.data` is read first, for the field description that says a base64 chunk
 * can come back instead. The API has no speed parameter — only `qwen3-tts-instruct-flash` takes a
 * natural-language `instructions` — so `rate` is null and the page says the slider does not apply.
 */
const SITES: Record<string, string> = {
  beijing: "https://dashscope.aliyuncs.com",
  singapore: "https://dashscope-intl.aliyuncs.com",
};

/** `input.language_type`; "Auto" for a language it does not name. */
const LANGUAGE_TYPES: Record<string, string> = {
  zh: "Chinese",
  en: "English",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  es: "Spanish",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  ru: "Russian",
};

export function qwenLanguageType(language: string): string {
  return LANGUAGE_TYPES[language.split("-")[0]?.toLowerCase() ?? ""] ?? "Auto";
}

const female = (id: string, zh: string): TtsVoice => ({
  id,
  name: { zh: `${zh}（${id}）`, en: `${id} · ${zh}` },
  gender: "female",
});
const male = (id: string, zh: string): TtsVoice => ({
  id,
  name: { zh: `${zh}（${id}）`, en: `${id} · ${zh}` },
  gender: "male",
});

/**
 * The 48 non-realtime system voices. A voice is not tied to a language: the voice list says every
 * one of them speaks its own Chinese / dialect **plus** English, French, German, Russian, Italian,
 * Spanish, Portuguese, Japanese and Korean — so this is one list whatever the call language is, and
 * `input.language_type` (not the voice) selects the language.
 */
const VOICES: TtsVoice[] = [
  female("Cherry", "芊悦"),
  female("Serena", "苏瑶"),
  female("Chelsie", "千雪"),
  female("Momo", "茉兔"),
  female("Vivian", "十三"),
  female("Maia", "四月"),
  female("Bella", "萌宝"),
  female("Jennifer", "詹妮弗"),
  female("Katerina", "卡捷琳娜"),
  female("Mia", "乖小妹"),
  female("Bellona", "燕铮莺"),
  female("Bunny", "萌小姬"),
  female("Elias", "墨讲师"),
  female("Nini", "邻家妹妹"),
  female("Seren", "小婉"),
  female("Stella", "少女阿月"),
  female("Sonrisa", "索尼莎"),
  female("Sohee", "素熙"),
  female("Ono Anna", "小野杏"),
  female("Jada", "上海-阿珍"),
  female("Sunny", "四川-晴儿"),
  female("Kiki", "粤语-阿清"),
  male("Ethan", "晨煦"),
  male("Moon", "月白"),
  male("Kai", "凯"),
  male("Nofish", "不吃鱼"),
  male("Ryan", "甜茶"),
  male("Aiden", "艾登"),
  male("Eldric Sage", "沧明子"),
  male("Mochi", "沙小弥"),
  male("Vincent", "田叔"),
  male("Neil", "阿闻"),
  male("Arthur", "徐大爷"),
  male("Pip", "顽屁小孩"),
  male("Bodega", "博德加"),
  male("Alek", "阿列克"),
  male("Dolce", "多尔切"),
  male("Lenn", "莱恩"),
  male("Emilien", "埃米尔安"),
  male("Andre", "安德雷"),
  male("Radio Gol", "拉迪奥·戈尔"),
  male("Dylan", "北京-晓东"),
  male("Li", "南京-老李"),
  male("Marcus", "陕西-秦川"),
  male("Roy", "闽南-阿杰"),
  male("Peter", "天津-李彼得"),
  male("Eric", "四川-程川"),
  male("Rocky", "粤语-阿强"),
];

interface QwenResponse {
  code?: string;
  message?: string;
  output?: { audio?: { data?: string; url?: string } };
}

export const qwen: TtsEngine = {
  id: "qwen",
  name: "阿里云百炼",
  category: "cloud",
  site: "dashscope.aliyuncs.com",
  docs: "https://help.aliyun.com/zh/model-studio/qwen-tts-api",
  fields: [
    {
      key: "site",
      label: { zh: "地域", en: "Region" },
      kind: "select",
      default: "beijing",
      options: [
        { value: "beijing", label: { zh: "北京", en: "Beijing" } },
        { value: "singapore", label: { zh: "新加坡（国际站）", en: "Singapore (international)" } },
      ],
      hint: {
        zh: "两个地域的 API Key 不通用，要和 Key 所属地域一致。",
        en: "The two regions have separate API keys; pick the one your key belongs to.",
      },
    },
    { key: "apiKey", label: "API Key", kind: "secret", placeholder: "sk-…" },
  ],
  models: ["qwen3-tts-flash", "qwen3-tts-instruct-flash"],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "Cherry",
  // No speed parameter on the HTTP endpoint.
  rate: null,
  async synthesize(input, config, ctx) {
    const values = fieldValues(qwen, config);
    const base = SITES[values.site ?? "beijing"] ?? SITES.beijing;
    const json = await jsonBody<QwenResponse>(
      await postJson(
        ctx,
        `${base}/api/v1/services/aigc/multimodal-generation/generation`,
        { Authorization: `Bearer ${values.apiKey}` },
        {
          model: input.model,
          input: {
            text: input.text,
            voice: input.voice,
            language_type: qwenLanguageType(input.language),
          },
        },
      ),
      "Qwen TTS",
    );
    if (json.code) throw new VoiceHttpError(`Qwen TTS ${json.code}: ${json.message ?? ""}`, 400);
    const audio = json.output?.audio;
    // The docs describe `data` as a base64 chunk, but the non-streaming example leaves it empty and
    // answers with a URL; both are accepted.
    if (audio?.data) return toAudioBlob(base64ToBytes(audio.data), { kind: "auto" });
    return audioFromUrl(valueAt(json, "output.audio.url"), ctx);
  },
};
