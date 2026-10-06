import { VoiceHttpError } from "../../errors.ts";
import { audioFromJson, ensureOk, jsonDocuments, postJson, toAudioBlob } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * 豆包语音合成, V3 HTTP unidirectional streaming over SSE (volcengine.com/docs/6561/1598757,
 * checked 2026-09-29): the documented recommendation for the large-model voices; V1 is marked
 * "not recommended" and has no 2.0 voices. Each `event: 352` frame carries base64 audio in `data`;
 * `code` 20000000 ends the session, any other non-zero code is a failure.
 *

 * A voice's id names the language it was built for (zh_* / en_*), but the 2.0 (`_uranus_`) voices
 * also do automatic recognition of 30+ languages, so they are offered as one list rather than per
 * call language.
 *
 * A voice only works with its own resource id (2.0 voices with seed-tts-2.0, 1.0 with
 * seed-tts-1.0; a mismatch fails with 45000000), so the resource follows the voice id's family
 * and the model picks it only for voices that do not say (cloned voices: seed-icl-*).
 */
const ENDPOINT = "https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse";
const SESSION_FINISHED = 20000000;

export function doubaoResource(voice: string, model: string): string {
  if (voice.includes("_uranus_")) return "seed-tts-2.0";
  if (/_(moon|mars)_/.test(voice)) return "seed-tts-1.0";
  return model;
}

const v2 = (id: string, zh: string, gender: "female" | "male"): TtsVoice => ({
  id: `${id}_uranus_bigtts`,
  name: { zh: `${zh}（2.0）`, en: `${zh} (2.0)` },
  gender,
});
const v1 = (id: string, zh: string, gender: "female" | "male"): TtsVoice => ({
  id,
  name: { zh: `${zh}（1.0）`, en: `${zh} (1.0)` },
  gender,
});

const VOICES: TtsVoice[] = [
  v2("zh_female_vv", "Vivi", "female"),
  v2("zh_female_xiaohe", "小何", "female"),
  v2("zh_female_sophie", "魅力苏菲", "female"),
  v2("zh_female_qingxinnvsheng", "清新女声", "female"),
  v2("zh_female_cancan", "知性灿灿", "female"),
  v2("zh_female_tianmeixiaoyuan", "甜美小源", "female"),
  v2("zh_female_shuangkuaisisi", "爽快思思", "female"),
  v2("zh_female_linjianvhai", "邻家女孩", "female"),
  v2("zh_female_kefunvsheng", "暖阳女声", "female"),
  v2("en_female_dacey", "Dacey", "female"),
  v2("en_female_allison", "Allison", "female"),
  v2("zh_male_m191", "云舟", "male"),
  v2("zh_male_taocheng", "小天", "male"),
  v2("zh_male_liufei", "刘飞", "male"),
  v2("zh_male_shaonianzixin", "少年梓辛", "male"),
  v2("zh_male_ruyayichen", "儒雅逸辰", "male"),
  v2("zh_male_jieshuoxiaoming", "解说小明", "male"),
  v2("en_male_tim", "Tim", "male"),
  v2("en_male_alex", "Alex", "male"),
  v1("zh_female_shuangkuaisisi_moon_bigtts", "爽快思思", "female"),
  v1("zh_female_cancan_mars_bigtts", "灿灿", "female"),
  v1("zh_female_qinqienvsheng_moon_bigtts", "亲切女声", "female"),
  v1("zh_female_zhixingnvsheng_mars_bigtts", "知性女声", "female"),
  v1("en_female_amanda_mars_bigtts", "Amanda", "female"),
  v1("zh_male_wennuanahu_moon_bigtts", "温暖阿虎", "male"),
  v1("zh_male_yangguangqingnian_moon_bigtts", "阳光青年", "male"),
  v1("zh_male_yuanboxiaoshu_moon_bigtts", "渊博小叔", "male"),
  v1("en_male_adam_mars_bigtts", "Adam", "male"),
];

interface Frame {
  code?: number;
  message?: string;
  data?: string | null;
}

export const doubao: TtsEngine = {
  id: "doubao",
  name: "豆包",
  category: "cloud",
  site: "openspeech.bytedance.com",
  docs: "https://www.volcengine.com/docs/6561/1598757",
  fields: [
    {
      key: "apiKey",
      label: "API Key",
      kind: "secret",
      hint: {
        zh: "火山引擎豆包语音控制台的 API Key。音色要先在控制台开通（免费音色也要下 0 元单）。",
        en: "The API Key from the Volcengine Doubao Speech console. Enable each voice there first.",
      },
    },
    {
      key: "appId",
      label: "App ID",
      kind: "text",
      optional: true,
      hint: {
        zh: "旧版控制台才需要：填了 App ID，上面就填 Access Token。",
        en: "Only for the old console: with an App ID, put the Access Token above.",
      },
    },
  ],
  // X-Api-Resource-Id for voices whose id does not tell (cloned voices).
  models: ["seed-tts-2.0", "seed-tts-1.0", "seed-icl-2.0", "seed-icl-1.0"],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "zh_female_vv_uranus_bigtts",
  // audio_params.speech_rate: [-50, 100], 100 = 2×, -50 = 0.5×.
  rate: { min: 0.5, max: 2 },
  async synthesize(input, config, ctx) {
    const values = fieldValues(doubao, config);
    const auth: Record<string, string> = values.appId
      ? { "X-Api-App-Id": values.appId, "X-Api-Access-Key": values.apiKey ?? "" }
      : { "X-Api-Key": values.apiKey ?? "" };
    const resp = await postJson(
      ctx,
      ENDPOINT,
      {
        ...auth,
        "X-Api-Resource-Id": doubaoResource(input.voice, input.model),
        "X-Api-Request-Id": crypto.randomUUID(),
      },
      {
        user: { uid: "outbrief" },
        req_params: {
          text: input.text,
          speaker: input.voice,
          audio_params: {
            format: "mp3",
            sample_rate: 24000,
            speech_rate: Math.round((input.rate - 1) * 100),
          },
        },
      },
    );
    await ensureOk(resp, "豆包 TTS");
    const frames = jsonDocuments(await resp.text()) as Frame[];
    const failed = frames.find(
      (f) => f.code !== undefined && f.code !== 0 && f.code !== SESSION_FINISHED,
    );
    if (failed) {
      // 45000000 "quota exceeded for types: concurrency" is throttling.
      const status = /quota exceeded/i.test(failed.message ?? "") ? 429 : 400;
      throw new VoiceHttpError(`豆包 TTS ${failed.code}: ${failed.message ?? ""}`, status);
    }
    return toAudioBlob(audioFromJson(frames, "data", "base64"), { kind: "auto" });
  },
};
