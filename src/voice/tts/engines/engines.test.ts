import { describe, expect, it } from "vitest";
import { BUILTIN_ENGINES, TTS_ENGINES, ttsEngine } from "../registry.ts";
import { missingSetting, voiceFor } from "../settings.ts";
import { EMPTY_TEMPLATE } from "../template.ts";
import {
  EMPTY_TTS_CONFIG,
  fieldValues,
  localized,
  type TtsConfig,
  type TtsInput,
} from "../types.ts";
import { doubaoResource } from "./doubao.ts";
import { geminiLanguageCode, paceStyle } from "./gemini.ts";
import { grokLanguage } from "./grok.ts";
import { qwenLanguageType } from "./qwen.ts";
import { tc3Authorization, tencentSpeed } from "./tencent.ts";

const MP3_BYTES = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0]);
const MP3_BASE64 = "SUQzBAAAAAAA";

function mp3(): Response {
  return new Response(MP3_BYTES, { headers: { "Content-Type": "audio/mpeg" } });
}

function input(over: Partial<TtsInput> = {}): TtsInput {
  return { text: "第一句话。", voice: "v1", model: "m1", rate: 1, language: "zh-CN", ...over };
}

function config(values: Record<string, string>, over: Partial<TtsConfig> = {}): TtsConfig {
  return { ...EMPTY_TTS_CONFIG, values, ...over };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

/** Records every request and answers each with the next response. */
function recorder(...responses: Response[]) {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl: typeof fetch = async (url, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => {
      headers[key] = value;
    });
    const raw = init?.body;
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof raw === "string" ? raw : "",
    });
    return queue.shift() ?? mp3();
  };
  return { calls, ctx: { fetch: fetchImpl } };
}

describe("the engine registry", () => {
  it("lists Azure first (free, the default) and 自定义接口 last", () => {
    expect(TTS_ENGINES[0]?.id).toBe("azure");
    expect(TTS_ENGINES[TTS_ENGINES.length - 1]?.category).toBe("custom");
    expect(BUILTIN_ENGINES.every((e) => e.category !== "custom")).toBe(true);
    // Azure plus the 11 platforms the issue asks for.
    expect(BUILTIN_ENGINES).toHaveLength(12);
  });

  it("falls back to Azure for an engine id this version does not know", () => {
    expect(ttsEngine("from-the-future").id).toBe("azure");
    expect(ttsEngine("minimax").id).toBe("minimax");
  });

  it("gives every engine a usable default voice and unique field keys", () => {
    for (const engine of TTS_ENGINES) {
      const keys = engine.fields.map((f) => f.key);
      expect(new Set(keys).size, engine.id).toBe(keys.length);
      // A zero-shot engine has no presets; every other one must offer voices.
      if (!engine.customVoice) expect(engine.voices("zh-CN").length, engine.id).toBeGreaterThan(0);
      for (const voice of engine.voices("zh-CN")) {
        expect(localized(voice.name, "zh"), `${engine.id} ${voice.id}`).toBeTruthy();
        expect(localized(voice.name, "en"), `${engine.id} ${voice.id}`).toBeTruthy();
      }
      const fallback = engine.defaultVoice("zh-CN");
      if (engine.voices("zh-CN").length > 0) {
        expect(
          engine.voices("zh-CN").map((v) => v.id),
          engine.id,
        ).toContain(fallback);
      }
    }
  });

  it("asks for what each cloud engine needs before it can speak", () => {
    for (const engine of BUILTIN_ENGINES) {
      const missing = missingSetting(engine, EMPTY_TTS_CONFIG);
      if (engine.category === "free") expect(missing, engine.id).toBeNull();
      // A self-hosted engine's address has a default, so only cloud keys are missing.
      else if (engine.category === "cloud") expect(missing, engine.id).not.toBeNull();
      else expect(missing, engine.id).toBeNull();
    }
  });
});

describe("voiceFor", () => {
  const minimax = ttsEngine("minimax");

  it("keeps a saved voice the engine offers", () => {
    expect(voiceFor(minimax, config({}, { voice: "female-yujie" }), "zh-CN")).toBe("female-yujie");
  });

  it("keeps any id for an engine that takes one (cloned voices)", () => {
    expect(voiceFor(minimax, config({}, { voice: "my-clone-1" }), "zh-CN")).toBe("my-clone-1");
  });

  it("falls back to the engine's own default when nothing is saved", () => {
    expect(voiceFor(minimax, EMPTY_TTS_CONFIG, "zh-CN")).toBe("female-shaonv");
  });

  it("keeps a multilingual Azure voice across languages but drops one that cannot speak them", () => {
    const azure = ttsEngine("azure");
    // A multilingual voice is offered for other locales too, so it stays.
    const multilingual = config({}, { voice: "zh-CN-XiaoxiaoMultilingualNeural" });
    expect(voiceFor(azure, multilingual, "zh-CN")).toBe("zh-CN-XiaoxiaoMultilingualNeural");
    expect(voiceFor(azure, multilingual, "ja-JP")).toBe("zh-CN-XiaoxiaoMultilingualNeural");
    // A plain Chinese voice cannot speak Japanese, so that language's own voice is used, and the
    // saved one is left alone for when the language switches back.
    const plain = config({}, { voice: "zh-CN-XiaoyiNeural" });
    expect(voiceFor(azure, plain, "ja-JP")).toMatch(/^ja-JP-/);
    expect(plain.voice).toBe("zh-CN-XiaoyiNeural");
  });
});

describe("MiniMax", () => {
  const minimax = ttsEngine("minimax");

  it("posts t2a_v2 to the site's domain with the speed and hex output", async () => {
    const { calls, ctx } = recorder(
      new Response(JSON.stringify({ data: { audio: "49443304" }, base_resp: { status_code: 0 } })),
    );
    const blob = await minimax.synthesize(
      input({ rate: 1.5, voice: "female-yujie" }),
      config({ apiKey: "k1", site: "intl" }),
      ctx,
    );
    expect(blob.type).toBe("audio/mpeg");
    const call = calls[0];
    expect(call?.url).toBe("https://api.minimax.io/v1/t2a_v2");
    expect(call?.headers.authorization).toBe("Bearer k1");
    expect(JSON.parse(call?.body ?? "{}")).toMatchObject({
      text: "第一句话。",
      stream: false,
      output_format: "hex",
      voice_setting: { voice_id: "female-yujie", speed: 1.5 },
    });
  });

  it("uses the China domain by default", async () => {
    const { calls, ctx } = recorder(
      new Response(JSON.stringify({ data: { audio: "49443304" }, base_resp: { status_code: 0 } })),
    );
    await minimax.synthesize(input(), config({ apiKey: "k" }), ctx);
    expect(calls[0]?.url.startsWith("https://api.minimax.cn/")).toBe(true);
  });

  it("fails on a non-zero base_resp even though the HTTP status is 200", async () => {
    const { ctx } = recorder(
      new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "auth failed" } })),
    );
    await expect(minimax.synthesize(input(), config({ apiKey: "bad" }), ctx)).rejects.toMatchObject(
      {
        status: 400,
      },
    );
  });

  it("marks a rate-limit code as retryable", async () => {
    const { ctx } = recorder(
      new Response(JSON.stringify({ base_resp: { status_code: 1002, status_msg: "rate limit" } })),
    );
    await expect(minimax.synthesize(input(), config({ apiKey: "k" }), ctx)).rejects.toMatchObject({
      status: 429,
    });
  });

  it("lists the account's cloned voices before the system ones", async () => {
    const { calls, ctx } = recorder(
      new Response(
        JSON.stringify({
          base_resp: { status_code: 0 },
          system_voice: [{ voice_id: "female-shaonv", voice_name: "少女" }],
          voice_cloning: [{ voice_id: "clone-1" }],
        }),
      ),
    );
    const voices = await minimax.listVoices?.(config({ apiKey: "k" }), ctx);
    expect(voices?.map((v) => v.id)).toEqual(["clone-1", "female-shaonv"]);
    // A cloned voice with no name shows its id.
    expect(voices?.[0]?.name).toBe("clone-1");
    expect(calls[0]?.url).toBe("https://api.minimax.cn/v1/get_voice");
  });
});

describe("豆包", () => {
  const doubao = ttsEngine("doubao");

  it("picks the resource id a voice belongs to, so 2.0 and 1.0 voices both work", () => {
    expect(doubaoResource("zh_female_vv_uranus_bigtts", "seed-tts-1.0")).toBe("seed-tts-2.0");
    expect(doubaoResource("zh_female_cancan_mars_bigtts", "seed-tts-2.0")).toBe("seed-tts-1.0");
    expect(doubaoResource("zh_male_wennuanahu_moon_bigtts", "seed-tts-2.0")).toBe("seed-tts-1.0");
    // A cloned voice says nothing, so the chosen model decides.
    expect(doubaoResource("S_abc123", "seed-icl-2.0")).toBe("seed-icl-2.0");
  });

  it("joins the base64 chunks of the SSE frames and maps the rate to speech_rate", async () => {
    const body = [
      "event: 352",
      `data: {"code":0,"data":"${MP3_BASE64}"}`,
      "event: 351",
      'data: {"code":0,"data":null}',
      "event: 152",
      'data: {"code":20000000,"message":"OK"}',
      "",
    ].join("\n");
    const { calls, ctx } = recorder(new Response(body));
    const blob = await doubao.synthesize(
      input({ rate: 1.5, voice: "zh_female_vv_uranus_bigtts" }),
      config({ apiKey: "key" }),
      ctx,
    );
    expect(blob.type).toBe("audio/mpeg");
    const call = calls[0];
    expect(call?.url).toBe("https://openspeech.bytedance.com/api/v3/tts/unidirectional/sse");
    expect(call?.headers["x-api-key"]).toBe("key");
    expect(call?.headers["x-api-resource-id"]).toBe("seed-tts-2.0");
    expect(JSON.parse(call?.body ?? "{}")).toMatchObject({
      req_params: { speaker: "zh_female_vv_uranus_bigtts", audio_params: { speech_rate: 50 } },
    });
  });

  it("sends the old console's App ID and Access Token when an App ID is filled in", async () => {
    const { calls, ctx } = recorder(new Response(`data: {"code":0,"data":"${MP3_BASE64}"}`));
    await doubao.synthesize(input(), config({ apiKey: "token", appId: "app1" }), ctx);
    expect(calls[0]?.headers["x-api-app-id"]).toBe("app1");
    expect(calls[0]?.headers["x-api-access-key"]).toBe("token");
    expect(calls[0]?.headers["x-api-key"]).toBeUndefined();
  });

  it("reports a failure frame, and treats a concurrency quota as retryable", async () => {
    const denied = recorder(
      new Response('data: {"code":45000000,"message":"speaker permission denied"}'),
    );
    await expect(
      doubao.synthesize(input(), config({ apiKey: "k" }), denied.ctx),
    ).rejects.toMatchObject({ status: 400 });
    const throttled = recorder(
      new Response('data: {"code":45000000,"message":"quota exceeded for types: concurrency"}'),
    );
    await expect(
      doubao.synthesize(input(), config({ apiKey: "k" }), throttled.ctx),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("OpenAI", () => {
  const openai = ttsEngine("openai");

  it("posts the sentence, voice and speed and takes the body as the audio", async () => {
    const { calls, ctx } = recorder(mp3());
    const blob = await openai.synthesize(
      input({ model: "gpt-4o-mini-tts", voice: "marin", rate: 1.2 }),
      config({ apiKey: "sk-1" }),
      ctx,
    );
    expect(blob.type).toBe("audio/mpeg");
    expect(calls[0]?.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(calls[0]?.headers.authorization).toBe("Bearer sk-1");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      model: "gpt-4o-mini-tts",
      input: "第一句话。",
      voice: "marin",
      response_format: "mp3",
      speed: 1.2,
    });
  });

  it("honours a custom base URL, trailing slash and all", async () => {
    const { calls, ctx } = recorder(mp3());
    await openai.synthesize(
      input(),
      config({ apiKey: "k", baseUrl: "https://proxy.test/v1/" }),
      ctx,
    );
    expect(calls[0]?.url).toBe("https://proxy.test/v1/audio/speech");
  });
});

describe("Gemini", () => {
  const gemini = ttsEngine("gemini");

  it("has no numeric speed, so it asks for the pace in the style", () => {
    expect(gemini.rate).toBeNull();
    expect(paceStyle(1)).toBeUndefined();
    expect(paceStyle(1.5)).toBe("speaking rapidly");
    expect(paceStyle(0.6)).toBe("speaking slowly");
  });

  it("sends only the language codes the API accepts, Mandarin as cmn-CN", () => {
    expect(geminiLanguageCode("zh-CN")).toBe("cmn-CN");
    expect(geminiLanguageCode("ja-JP")).toBe("ja-JP");
    expect(geminiLanguageCode("zh-TW")).toBeUndefined();
    expect(geminiLanguageCode("sv-SE")).toBeUndefined();
  });

  it("asks for WAV explicitly and reads the base64 audio out of inlineData", async () => {
    const { calls, ctx } = recorder(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: MP3_BASE64 } }] } }],
        }),
      ),
    );
    const blob = await gemini.synthesize(
      input({ model: "gemini-3.8-flash-tts", voice: "Kore", rate: 1.5 }),
      config({ apiKey: "AIza" }),
      ctx,
    );
    expect(blob.type).toBe("audio/mpeg");
    const call = calls[0];
    expect(call?.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash-tts:generateContent",
    );
    expect(call?.headers["x-goog-api-key"]).toBe("AIza");
    const body = JSON.parse(call?.body ?? "{}");
    expect(body.generationConfig.responseFormat.audio.mimeType).toBe("AUDIO_WAV");
    expect(body.generationConfig.speechConfig).toEqual({
      voiceConfig: { voice: "Kore" },
      languageCode: "cmn-CN",
    });
    expect(body.contents[0].parts[0]).toEqual({
      text: "第一句话。",
      speech_metadata: { style: "speaking rapidly" },
    });
  });

  it("leaves out speech_metadata and languageCode when neither applies", async () => {
    const { calls, ctx } = recorder(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ inlineData: { data: MP3_BASE64 } }] } }],
        }),
      ),
    );
    await gemini.synthesize(input({ language: "sv-SE" }), config({ apiKey: "k" }), ctx);
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.contents[0].parts[0]).toEqual({ text: "第一句话。" });
    expect(body.generationConfig.speechConfig.languageCode).toBeUndefined();
  });
});

describe("Grok", () => {
  const grok = ttsEngine("grok");

  it("sends the required language, falling back to auto for one it does not name", () => {
    expect(grokLanguage("zh-CN")).toBe("zh");
    expect(grokLanguage("pt-BR")).toBe("pt-BR");
    expect(grokLanguage("es-ES")).toBe("es-ES");
    // The same language in a region Grok does name.
    expect(grokLanguage("es-AR")).toBe("es-MX");
    expect(grokLanguage("zh-TW")).toBe("zh");
    expect(grokLanguage("sv-SE")).toBe("auto");
  });

  it("posts /v1/tts with the voice and speed", async () => {
    const { calls, ctx } = recorder(mp3());
    await grok.synthesize(input({ voice: "eve", rate: 1.2 }), config({ apiKey: "xai" }), ctx);
    expect(calls[0]?.url).toBe("https://api.x.ai/v1/tts");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({
      text: "第一句话。",
      language: "zh",
      voice_id: "eve",
      speed: 1.2,
    });
  });
});

describe("ElevenLabs", () => {
  const eleven = ttsEngine("elevenlabs");

  it("puts output_format in the query, the voice in the path and the key in xi-api-key", async () => {
    const { calls, ctx } = recorder(mp3());
    await eleven.synthesize(
      input({ voice: "JBFqnCBsd6RMkjVDRZzb", model: "eleven_v4", rate: 1.1 }),
      config({ apiKey: "sk_1" }),
      ctx,
    );
    const call = calls[0];
    expect(call?.url).toBe(
      "https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=mp3_44100_128",
    );
    expect(call?.headers["xi-api-key"]).toBe("sk_1");
    expect(JSON.parse(call?.body ?? "{}")).toEqual({
      text: "第一句话。",
      model_id: "eleven_v4",
      voice_settings: { speed: 1.1 },
    });
  });

  it("uses the chosen residency server", async () => {
    const { calls, ctx } = recorder(mp3());
    await eleven.synthesize(input(), config({ apiKey: "k", server: "eu" }), ctx);
    expect(calls[0]?.url.startsWith("https://api.eu.residency.elevenlabs.io/")).toBe(true);
  });

  it("clamps the rate to the 0.7–1.2 the API takes", () => {
    expect(eleven.rate).toEqual({ min: 0.7, max: 1.2 });
  });
});

describe("阿里云百炼 (Qwen-TTS)", () => {
  const qwen = ttsEngine("qwen");

  it("maps the call language to language_type, Auto when it is not offered", () => {
    expect(qwenLanguageType("zh-CN")).toBe("Chinese");
    expect(qwenLanguageType("en-US")).toBe("English");
    expect(qwenLanguageType("pt-BR")).toBe("Portuguese");
    expect(qwenLanguageType("th-TH")).toBe("Auto");
  });

  it("downloads the audio URL the non-streaming response carries", async () => {
    const { calls, ctx } = recorder(
      new Response(
        JSON.stringify({
          output: { audio: { data: "", url: "http://oss.test/a.wav", expires_at: 1 } },
        }),
      ),
      mp3(),
    );
    const blob = await qwen.synthesize(
      input({ model: "qwen3-tts-flash", voice: "Cherry" }),
      config({ apiKey: "sk-a" }),
      ctx,
    );
    expect(blob.type).toBe("audio/mpeg");
    expect(calls[0]?.url).toBe(
      "https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation",
    );
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      model: "qwen3-tts-flash",
      input: { text: "第一句话。", voice: "Cherry", language_type: "Chinese" },
    });
    // The second call downloads the audio.
    expect(calls[1]?.url).toBe("http://oss.test/a.wav");
  });

  it("takes inline base64 audio when the response carries it instead of a URL", async () => {
    const { calls, ctx } = recorder(
      new Response(JSON.stringify({ output: { audio: { data: MP3_BASE64 } } })),
    );
    const blob = await qwen.synthesize(input(), config({ apiKey: "sk-a" }), ctx);
    expect(blob.type).toBe("audio/mpeg");
    expect(calls).toHaveLength(1);
  });

  it("uses the Singapore domain when that region is picked", async () => {
    const { calls, ctx } = recorder(
      new Response(JSON.stringify({ output: { audio: { data: MP3_BASE64 } } })),
    );
    await qwen.synthesize(input(), config({ apiKey: "k", site: "singapore" }), ctx);
    expect(calls[0]?.url.startsWith("https://dashscope-intl.aliyuncs.com/")).toBe(true);
  });

  it("reports the error code the API answers with", async () => {
    const { ctx } = recorder(
      new Response(
        JSON.stringify({ code: "InvalidApiKey", message: "Invalid API-key provided." }),
        {
          status: 401,
        },
      ),
    );
    await expect(qwen.synthesize(input(), config({ apiKey: "bad" }), ctx)).rejects.toMatchObject({
      status: 401,
    });
  });

  it("has no speed parameter", () => {
    expect(qwen.rate).toBeNull();
  });
});

describe("腾讯云", () => {
  const tencent = ttsEngine("tencent");

  it("maps the rate onto the documented Speed points", () => {
    expect(tencentSpeed(1)).toBe(0);
    expect(tencentSpeed(1.2)).toBe(1);
    expect(tencentSpeed(1.5)).toBe(2);
    expect(tencentSpeed(0.8)).toBe(-1);
    // Between two points, and clamped past the ends.
    expect(tencentSpeed(1.35)).toBeCloseTo(1.5, 2);
    expect(tencentSpeed(0.4)).toBe(-2);
    expect(tencentSpeed(3)).toBe(6);
  });

  it("signs with TC3-HMAC-SHA256, using the UTC day of the timestamp", async () => {
    // 2026-01-01T00:30:00Z — a local date would sign the wrong day in most time zones.
    const authorization = await tc3Authorization({
      secretId: "AKIDtest",
      secretKey: "secret",
      body: '{"Text":"hi"}',
      timestamp: 1767227400,
    });
    expect(authorization).toMatch(
      /^TC3-HMAC-SHA256 Credential=AKIDtest\/2026-01-01\/tts\/tc3_request, SignedHeaders=content-type;host, Signature=[0-9a-f]{64}$/,
    );
    // The same request signs the same way; a different key does not.
    const again = await tc3Authorization({
      secretId: "AKIDtest",
      secretKey: "secret",
      body: '{"Text":"hi"}',
      timestamp: 1767227400,
    });
    expect(again).toBe(authorization);
    const other = await tc3Authorization({
      secretId: "AKIDtest",
      secretKey: "other",
      body: '{"Text":"hi"}',
      timestamp: 1767227400,
    });
    expect(other).not.toBe(authorization);
  });

  it("posts the action headers and reads base64 audio from Response.Audio", async () => {
    const { calls, ctx } = recorder(
      new Response(JSON.stringify({ Response: { Audio: MP3_BASE64, RequestId: "r1" } })),
    );
    const blob = await tencent.synthesize(
      input({ voice: "403001", rate: 1.2 }),
      config({ secretId: "AKID", secretKey: "sk" }),
      ctx,
    );
    expect(blob.type).toBe("audio/mpeg");
    const call = calls[0];
    expect(call?.url).toBe("https://tts.tencentcloudapi.com/");
    expect(call?.headers["x-tc-action"]).toBe("TextToVoice");
    expect(call?.headers["x-tc-version"]).toBe("2019-08-23");
    expect(call?.headers.authorization).toMatch(/^TC3-HMAC-SHA256 Credential=AKID\//);
    const body = JSON.parse(call?.body ?? "{}");
    expect(body).toMatchObject({
      Text: "第一句话。",
      VoiceType: 403001,
      Codec: "mp3",
      SampleRate: 24000,
      Speed: 1,
      PrimaryLanguage: 1,
    });
    expect(body.SessionId).toMatch(/[0-9a-f-]{36}/);
  });

  it("asks for 16 kHz for a 精品 voice, which has no 24 kHz, and English for other languages", async () => {
    const { calls, ctx } = recorder(
      new Response(JSON.stringify({ Response: { Audio: MP3_BASE64 } })),
    );
    await tencent.synthesize(
      input({ voice: "101011", language: "en-US" }),
      config({ secretId: "A", secretKey: "s" }),
      ctx,
    );
    const body = JSON.parse(calls[0]?.body ?? "{}");
    expect(body.SampleRate).toBe(16000);
    expect(body.PrimaryLanguage).toBe(2);
  });

  it("fails on Response.Error, which arrives with HTTP 200", async () => {
    const { ctx } = recorder(
      new Response(
        JSON.stringify({
          Response: { Error: { Code: "AuthFailure.SignatureFailure", Message: "bad signature" } },
        }),
      ),
    );
    await expect(
      tencent.synthesize(input(), config({ secretId: "A", secretKey: "s" }), ctx),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("treats a rate limit as retryable", async () => {
    const { ctx } = recorder(
      new Response(
        JSON.stringify({ Response: { Error: { Code: "RequestLimitExceeded", Message: "slow" } } }),
      ),
    );
    await expect(
      tencent.synthesize(input(), config({ secretId: "A", secretKey: "s" }), ctx),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("the self-hosted engines", () => {
  it("ChatTTS posts the OpenAI-compatible endpoint of its example server", async () => {
    const chattts = ttsEngine("chattts");
    const { calls, ctx } = recorder(mp3());
    await chattts.synthesize(input({ voice: "default" }), EMPTY_TTS_CONFIG, ctx);
    expect(calls[0]?.url).toBe("http://127.0.0.1:8000/v1/audio/speech");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
      model: "tts-1",
      input: "第一句话。",
      voice: "default",
      response_format: "mp3",
    });
    // Its server hardcodes [speed_5].
    expect(chattts.rate).toBeNull();
  });

  it("CosyVoice sends a form and wraps the headerless PCM at the chosen sample rate", async () => {
    const cosyvoice = ttsEngine("cosyvoice");
    const { calls, ctx } = recorder(new Response(new Uint8Array([1, 0, 2, 0])));
    const blob = await cosyvoice.synthesize(
      input({ voice: "中文女" }),
      config({ sampleRate: "24000" }),
      ctx,
    );
    expect(blob.type).toBe("audio/wav");
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(24000);
    expect(calls[0]?.url).toBe("http://127.0.0.1:50000/inference_sft");
    expect(calls[0]?.method).toBe("POST");
  });

  it("CosyVoice defaults to 22050, the sample rate of CosyVoice 1", async () => {
    const cosyvoice = ttsEngine("cosyvoice");
    const { ctx } = recorder(new Response(new Uint8Array([1, 0])));
    const blob = await cosyvoice.synthesize(input(), EMPTY_TTS_CONFIG, ctx);
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(22050);
  });

  it("IndexTTS posts vLLM's OpenAI-compatible endpoint with the speed", async () => {
    const indextts = ttsEngine("indextts");
    const { calls, ctx } = recorder(mp3());
    await indextts.synthesize(
      input({ voice: "my-voice", model: "IndexTeam/IndexTTS-2.5", rate: 1.5 }),
      config({ apiKey: "vllm-key" }),
      ctx,
    );
    expect(calls[0]?.url).toBe("http://127.0.0.1:8092/v1/audio/speech");
    expect(calls[0]?.headers.authorization).toBe("Bearer vllm-key");
    expect(JSON.parse(calls[0]?.body ?? "{}")).toMatchObject({ voice: "my-voice", speed: 1.5 });
  });

  it("IndexTTS leaves out the Authorization header when no key was set", async () => {
    const indextts = ttsEngine("indextts");
    const { calls, ctx } = recorder(mp3());
    await indextts.synthesize(input(), EMPTY_TTS_CONFIG, ctx);
    expect(calls[0]?.headers.authorization).toBeUndefined();
    // Its key is optional, so it is ready to speak without one.
    expect(missingSetting(indextts, EMPTY_TTS_CONFIG)).toBeNull();
  });
});

describe("fieldValues", () => {
  it("fills an engine's defaults for blanks and trims what was typed", () => {
    const qwen = ttsEngine("qwen");
    expect(fieldValues(qwen, config({ apiKey: "  sk-a  " }))).toEqual({
      site: "beijing",
      apiKey: "sk-a",
    });
  });
});

describe("which platforms have per-language voices", () => {
  /**
   * The distinction the voice picker depends on: MiniMax / 豆包-style ids belong to one language,
   * while ElevenLabs, Grok, OpenAI, Gemini and Qwen read every language with any voice (their docs
   * say so outright), so their list must NOT shrink when the call language changes.
   */
  const SAME_FOR_EVERY_LANGUAGE = ["elevenlabs", "grok", "openai", "gemini", "qwen", "tencent"];

  it("keeps one voice list for the platforms whose voices are language-agnostic", () => {
    for (const id of SAME_FOR_EVERY_LANGUAGE) {
      const engine = ttsEngine(id);
      const zh = engine.voices("zh-CN").map((v) => v.id);
      expect(zh.length, id).toBeGreaterThan(0);
      for (const language of ["en-US", "ja-JP", "de-DE", "pt-BR"]) {
        expect(
          engine.voices(language).map((v) => v.id),
          `${id} ${language}`,
        ).toEqual(zh);
      }
    }
  });

  it("gives MiniMax the call language's own voices", () => {
    const minimax = ttsEngine("minimax");
    const ids = (language: string) => minimax.voices(language).map((v) => v.id);
    expect(
      ids("zh-CN").every(
        (id) => id.startsWith("Chinese (Mandarin)_") || /^(female|male)-/.test(id),
      ),
    ).toBe(true);
    expect(ids("ja-JP").every((id) => id.startsWith("Japanese_"))).toBe(true);
    expect(ids("ko-KR").every((id) => id.startsWith("Korean_"))).toBe(true);
    expect(ids("pt-BR").every((id) => id.startsWith("Portuguese_"))).toBe(true);
    // Cantonese is its own group, however the app writes the locale.
    expect(ids("yue-CN").every((id) => id.startsWith("Cantonese_"))).toBe(true);
    expect(ids("zh-HK").every((id) => id.startsWith("Cantonese_"))).toBe(true);
    // Every language MiniMax documents brings more than the handful that used to be hardcoded.
    expect(ids("ja-JP").length).toBeGreaterThan(10);
    expect(ids("ko-KR").length).toBeGreaterThan(40);
  });

  it("starts each MiniMax language on a voice of that language", () => {
    const minimax = ttsEngine("minimax");
    for (const language of ["zh-CN", "en-US", "ja-JP", "ko-KR", "pt-BR", "yue-CN"]) {
      const fallback = minimax.defaultVoice(language);
      expect(
        minimax.voices(language).map((v) => v.id),
        language,
      ).toContain(fallback);
    }
  });

  it("falls back to English for a language MiniMax has no system voice for", () => {
    const minimax = ttsEngine("minimax");
    // Swedish is not in MiniMax's list; the picker still offers something usable.
    const ids = minimax.voices("sv-SE").map((v) => v.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.some((id) => id.startsWith("English_"))).toBe(true);
  });

  it("never offers a MiniMax voice whose name is empty", () => {
    const minimax = ttsEngine("minimax");
    for (const language of ["zh-CN", "ja-JP", "ko-KR", "es-ES"]) {
      for (const voice of minimax.voices(language)) {
        expect(localized(voice.name, "zh"), voice.id).toBeTruthy();
        expect(localized(voice.name, "en"), voice.id).toBeTruthy();
      }
    }
  });
});

describe("why 测试合成 is blocked", () => {
  /**
   * The disabled-button hint used to be the custom-cURL line ("还没指定哪个值是句子，请在上面点一下")
   * whatever the reason was, so a built-in platform missing only its API Key told the user to tap
   * something that page has not got (YOUT-191 review). The reason must name the real setting.
   */
  it("names the setting a built-in platform is still missing", () => {
    for (const id of ["doubao", "minimax", "openai", "elevenlabs"]) {
      const engine = ttsEngine(id);
      const missing = missingSetting(engine, EMPTY_TTS_CONFIG);
      // It is one of the platform's own fields — never the custom engine's "request".
      expect(missing, id).not.toBe("request");
      expect(
        engine.fields.map((f) => f.key),
        id,
      ).toContain(missing);
      const field = engine.fields.find((f) => f.key === missing);
      expect(localized(field?.label ?? "", "zh"), id).toBeTruthy();
    }
  });

  it("is the sentence-placeholder hint only for 自定义接口", () => {
    const custom = ttsEngine("custom");
    expect(missingSetting(custom, EMPTY_TTS_CONFIG)).toBe("request");
    // A pasted request that has no {{text}} yet is the one case that hint belongs to.
    const pasted = {
      ...EMPTY_TTS_CONFIG,
      request: { ...EMPTY_TEMPLATE, url: "https://x.test/tts", body: '{"input":"hi"}' },
    };
    expect(missingSetting(custom, pasted)).toBe("request");
  });

  it("is nothing once a built-in platform has its key, so the button works", () => {
    const doubao = ttsEngine("doubao");
    const ready = { ...EMPTY_TTS_CONFIG, values: { apiKey: "k" } };
    expect(missingSetting(doubao, ready)).toBeNull();
    expect(doubao.defaultVoice("zh-CN")).toBeTruthy();
  });
});
