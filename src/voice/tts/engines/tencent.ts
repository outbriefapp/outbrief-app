import { VoiceHttpError } from "../../errors.ts";
import { base64ToBytes, jsonBody, toAudioBlob } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * 腾讯云 基础语音合成 TextToVoice, API 3.0 (cloud.tencent.com/document/api/1073/37control, checked
 * 2026-09-29): base64 audio in `Response.Audio`, signed with TC3-HMAC-SHA256.
 *
 * Every response is HTTP 200 — failures are `Response.Error` — and the endpoint sends no CORS
 * headers, so inside Tauri this only works through the Rust HTTP plugin (which is where every TTS
 * request goes anyway).
 */
const HOST = "tts.tencentcloudapi.com";
const SERVICE = "tts";
const ACTION = "TextToVoice";
const VERSION = "2019-08-23";
const ALGORITHM = "TC3-HMAC-SHA256";
const CONTENT_TYPE = "application/json";

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const material = key instanceof Uint8Array ? (key.slice().buffer as ArrayBuffer) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    material,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
}

/**
 * The `Authorization` header for one request. `date` is the UTC day of `timestamp` (a local date
 * makes the signature fail around midnight), and the signed headers are exactly the ones sent.
 */
export async function tc3Authorization(args: {
  secretId: string;
  secretKey: string;
  body: string;
  timestamp: number;
}): Promise<string> {
  const date = new Date(args.timestamp * 1000).toISOString().slice(0, 10);
  const canonicalRequest = [
    "POST",
    "/",
    "",
    `content-type:${CONTENT_TYPE}\nhost:${HOST}\n`,
    "content-type;host",
    await sha256Hex(args.body),
  ].join("\n");
  const scope = `${date}/${SERVICE}/tc3_request`;
  const stringToSign = [
    ALGORITHM,
    String(args.timestamp),
    scope,
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const secretDate = await hmac(new TextEncoder().encode(`TC3${args.secretKey}`), date);
  const secretService = await hmac(secretDate, SERVICE);
  const secretSigning = await hmac(secretService, "tc3_request");
  const signature = hex(await hmac(secretSigning, stringToSign));
  return `${ALGORITHM} Credential=${args.secretId}/${scope}, SignedHeaders=content-type;host, Signature=${signature}`;
}

/** `Speed`: -2 = 0.6×, 0 = 1×, 1 = 1.2×, 2 = 1.5×, 6 = 2.5× — interpolated over those points. */
export function tencentSpeed(rate: number): number {
  const points: [number, number][] = [
    [0.6, -2],
    [0.8, -1],
    [1, 0],
    [1.2, 1],
    [1.5, 2],
    [2.5, 6],
  ];
  const first = points[0] as [number, number];
  const last = points[points.length - 1] as [number, number];
  if (rate <= first[0]) return first[1];
  if (rate >= last[0]) return last[1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i] as [number, number];
    const [x0, y0] = points[i - 1] as [number, number];
    if (rate <= x1) {
      const value = y0 + ((rate - x0) / (x1 - x0)) * (y1 - y0);
      return Math.round(value * 100) / 100;
    }
  }
  return 0;
}

const voice = (id: number, zh: string, kind: string, gender?: "female" | "male"): TtsVoice => ({
  id: String(id),
  name: { zh: `${zh} · ${kind}`, en: `${zh} · ${kind}` },
  ...(gender ? { gender } : {}),
});

/**
 * A shortlist of 基础语音合成 voices: the 超自然大模型 / 大模型 tiers first, then 精品.
 *
 * Voices here DO belong to a language — the list marks each one 中英文 / 中文 / 英文 / 粤语, and
 * `PrimaryLanguage` only takes 1 (中文) or 2 (英文). Most of the ones offered are 中英文, so they are
 * kept as one list; a call in any other language will not sound right on this platform, whichever
 * voice is chosen. 粤语 (智彤) and the 外语 / 英文 voices are labelled in their names.
 */
const VOICES: TtsVoice[] = [
  voice(403001, "云小和", "聊天女声 · 超自然大模型", "female"),
  voice(402000, "云晓芙", "聊天女声 · 超自然大模型", "female"),
  voice(502003, "智小敏", "聊天女声 · 超自然大模型", "female"),
  voice(502001, "智小柔", "聊天女声 · 超自然大模型", "female"),
  voice(502004, "智小满", "营销女声 · 超自然大模型", "female"),
  voice(602005, "专业梓欣", "聊天女声 · 超自然大模型", "female"),
  voice(602003, "爱小悠", "聊天女声 · 超自然大模型", "female"),
  voice(603004, "温柔小柠", "聊天女声 · 超自然大模型", "female"),
  voice(603007, "邻家女孩", "聊天女声 · 超自然大模型", "female"),
  voice(603001, "潇湘妹妹", "特色女声 · 超自然大模型", "female"),
  voice(403000, "云小朵", "特色女童声 · 超自然大模型", "female"),
  voice(501001, "智兰", "资讯女声 · 大模型", "female"),
  voice(501002, "智菊", "阅读女声 · 大模型", "female"),
  voice(501004, "月华", "聊天女声 · 大模型", "female"),
  voice(601009, "爱小芊", "聊天女声 · 大模型 · 多情感", "female"),
  voice(601013, "爱小伊", "阅读女声 · 大模型", "female"),
  voice(501009, "WeWinny", "外语女声 · 大模型", "female"),
  voice(101011, "智燕", "新闻女声 · 精品", "female"),
  voice(101001, "智瑜", "情感女声 · 精品", "female"),
  voice(101019, "智彤", "粤语女声 · 精品", "female"),
  voice(403002, "云小帅", "解说男声 · 超自然大模型", "male"),
  voice(502006, "智小悟", "聊天男声 · 超自然大模型", "male"),
  voice(502005, "智小解", "解说男声 · 超自然大模型", "male"),
  voice(602004, "暖心阿灿", "聊天男声 · 超自然大模型", "male"),
  voice(603003, "随和老李", "聊天男声 · 超自然大模型", "male"),
  voice(603005, "知心大林", "聊天男声 · 超自然大模型", "male"),
  voice(603006, "沉稳青叔", "聊天男声 · 超自然大模型", "male"),
  voice(603000, "懂事少年", "特色男声 · 超自然大模型", "male"),
  voice(501000, "智斌", "阅读男声 · 大模型", "male"),
  voice(501003, "智宇", "阅读男声 · 大模型", "male"),
  voice(501005, "飞镜", "聊天男声 · 大模型", "male"),
  voice(501006, "千嶂", "聊天男声 · 大模型", "male"),
  voice(601008, "爱小豪", "聊天男声 · 大模型 · 多情感", "male"),
  voice(501008, "WeJames", "外语男声 · 大模型", "male"),
  voice(101013, "智辉", "新闻男声 · 精品", "male"),
  voice(101030, "智柯", "通用男声 · 精品", "male"),
  voice(101004, "智云", "通用男声 · 精品", "male"),
  voice(101050, "WeJack", "英文男声 · 精品", "male"),
];

/** The 精品 (1010xx) voices have no 24 kHz; everything else does. */
function sampleRate(voiceId: string): number {
  return voiceId.startsWith("1010") ? 16000 : 24000;
}

interface TencentResponse {
  Response?: { Audio?: string; Error?: { Code?: string; Message?: string } };
}

export const tencent: TtsEngine = {
  id: "tencent",
  name: "腾讯云",
  category: "cloud",
  site: "tts.tencentcloudapi.com",
  docs: "https://cloud.tencent.com/document/product/1073/37995",
  fields: [
    { key: "secretId", label: "SecretId", kind: "text", placeholder: "AKID…" },
    { key: "secretKey", label: "SecretKey", kind: "secret" },
  ],
  // ModelType 1 is the only documented value; there is no model to choose.
  models: [],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "403001",
  // Speed: -2 (0.6×) … 6 (2.5×); the slider's own range is what the app offers.
  rate: { min: 0.6, max: 2 },
  async synthesize(input, config, ctx) {
    const values = fieldValues(tencent, config);
    // 中文最多 150 个汉字 / 英文 500 个字母; a brief's sentences are shorter, and a longer one is
    // rejected by the API rather than silently cut.
    const body = JSON.stringify({
      Text: input.text,
      SessionId: crypto.randomUUID(),
      VoiceType: Number(input.voice) || 0,
      Codec: "mp3",
      SampleRate: sampleRate(input.voice),
      Speed: tencentSpeed(input.rate),
      PrimaryLanguage: /^(zh|yue|wuu)/i.test(input.language) ? 1 : 2,
      ModelType: 1,
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const authorization = await tc3Authorization({
      secretId: values.secretId ?? "",
      secretKey: values.secretKey ?? "",
      body,
      timestamp,
    });
    const json = await jsonBody<TencentResponse>(
      await ctx.fetch(`https://${HOST}/`, {
        method: "POST",
        headers: {
          Authorization: authorization,
          "Content-Type": CONTENT_TYPE,
          Host: HOST,
          "X-TC-Action": ACTION,
          "X-TC-Version": VERSION,
          "X-TC-Timestamp": String(timestamp),
        },
        body,
        signal: ctx.signal,
      }),
      "腾讯云 TTS",
    );
    const error = json.Response?.Error;
    if (error) {
      const throttled = /LimitExceeded|RequestLimitExceeded|ExceedMaxLimit/.test(error.Code ?? "");
      throw new VoiceHttpError(
        `腾讯云 TTS ${error.Code ?? ""}: ${error.Message ?? ""}`,
        throttled ? 429 : 400,
      );
    }
    const audio = json.Response?.Audio;
    if (!audio) throw new VoiceHttpError("腾讯云 TTS returned no audio");
    return toAudioBlob(base64ToBytes(audio), { kind: "auto" });
  },
};
