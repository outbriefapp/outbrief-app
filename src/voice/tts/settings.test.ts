import { describe, expect, it } from "vitest";
import { audioCacheKey } from "../audioCache.ts";
import { ttsEngine } from "./registry.ts";
import { configOf, missingSetting, normalizeTts, voiceOptions } from "./settings.ts";
import { EMPTY_TEMPLATE, type HttpTemplate } from "./template.ts";
import { EMPTY_TTS_CONFIG, type TtsInput } from "./types.ts";

describe("normalizeTts", () => {
  it("defaults to Azure with nothing configured", () => {
    expect(normalizeTts(undefined)).toEqual({ engine: "azure", configs: {} });
    expect(normalizeTts("nonsense")).toEqual({ engine: "azure", configs: {} });
  });

  it("moves a voice saved before engines existed onto Azure", () => {
    expect(normalizeTts(undefined, "zh-CN-XiaoyiNeural").configs.azure).toEqual({
      values: {},
      model: "",
      voice: "zh-CN-XiaoyiNeural",
    });
  });

  it("keeps a saved Azure config over the legacy voice", () => {
    const stored = { engine: "azure", configs: { azure: { voice: "ja-JP-AoiNeural" } } };
    expect(normalizeTts(stored, "zh-CN-XiaoyiNeural").configs.azure?.voice).toBe("ja-JP-AoiNeural");
  });

  it("drops an engine id this version does not have", () => {
    expect(normalizeTts({ engine: "some-new-engine" }).engine).toBe("azure");
  });

  it("keeps every engine's own config, so switching back loses nothing", () => {
    const stored = {
      engine: "minimax",
      configs: {
        minimax: { values: { apiKey: "k1" }, model: "speech-2.8-hd", voice: "female-yujie" },
        openai: { values: { apiKey: "sk-1" }, model: "gpt-4o-mini-tts", voice: "marin" },
      },
    };
    const tts = normalizeTts(stored);
    expect(tts.engine).toBe("minimax");
    expect(tts.configs.openai?.voice).toBe("marin");
    expect(configOf(tts, "openai").values.apiKey).toBe("sk-1");
  });

  it("throws away values that are not strings, whatever was stored", () => {
    const stored = {
      configs: { minimax: { values: { apiKey: "k", n: 5, o: null }, model: 7, voice: [] } },
    };
    expect(normalizeTts(stored).configs.minimax).toEqual({
      values: { apiKey: "k" },
      model: "",
      voice: "",
    });
  });

  it("returns the empty config for an engine nothing was saved for", () => {
    expect(configOf(normalizeTts(undefined), "openai")).toEqual(EMPTY_TTS_CONFIG);
  });

  it("repairs a half-written custom request instead of dropping it", () => {
    const stored = {
      engine: "custom",
      configs: {
        custom: {
          request: {
            method: "PATCH",
            url: "https://x.test/tts",
            headers: [{ name: "X-A", value: "1" }, "junk", { name: 1, value: 2 }],
            response: { source: "json", path: "a.b", encoding: "nope", sampleRate: -1 },
          },
        },
      },
    };
    const request = normalizeTts(stored).configs.custom?.request as HttpTemplate;
    // An unsupported method falls back to POST rather than being sent as PATCH.
    expect(request.method).toBe("POST");
    expect(request.url).toBe("https://x.test/tts");
    expect(request.headers).toEqual([{ name: "X-A", value: "1" }]);
    expect(request.body).toBe("");
    expect(request.response).toEqual({
      source: "json",
      path: "a.b",
      encoding: "base64",
      format: "auto",
      sampleRate: 24000,
    });
  });
});

describe("missingSetting", () => {
  it("names the first setting an engine still needs", () => {
    expect(missingSetting(ttsEngine("openai"), EMPTY_TTS_CONFIG)).toBe("apiKey");
    expect(missingSetting(ttsEngine("tencent"), EMPTY_TTS_CONFIG)).toBe("secretId");
    expect(
      missingSetting(ttsEngine("tencent"), { ...EMPTY_TTS_CONFIG, values: { secretId: "A" } }),
    ).toBe("secretKey");
  });

  it("is satisfied once every required setting is filled in", () => {
    const config = { ...EMPTY_TTS_CONFIG, values: { apiKey: "sk-1" } };
    expect(missingSetting(ttsEngine("openai"), config)).toBeNull();
  });

  it("wants a usable request from the custom engine", () => {
    const custom = ttsEngine("custom");
    expect(missingSetting(custom, EMPTY_TTS_CONFIG)).toBe("request");
    expect(missingSetting(custom, { ...EMPTY_TTS_CONFIG, request: EMPTY_TEMPLATE })).toBe(
      "request",
    );
    const ready: HttpTemplate = {
      ...EMPTY_TEMPLATE,
      url: "https://x.test/tts",
      body: '{"input":"{{text}}"}',
    };
    expect(missingSetting(custom, { ...EMPTY_TTS_CONFIG, request: ready })).toBeNull();
  });
});

describe("voiceOptions", () => {
  it("resolves the engine, its config and a voice for the call language", () => {
    const tts = normalizeTts({
      engine: "minimax",
      configs: { minimax: { values: { apiKey: "k" }, model: "speech-2.8-hd", voice: "" } },
    });
    expect(voiceOptions(tts, 1.2, "zh-CN")).toEqual({
      engine: "minimax",
      config: { values: { apiKey: "k" }, model: "speech-2.8-hd", voice: "" },
      voice: "female-shaonv",
      rate: 1.2,
      language: "zh-CN",
    });
  });
});

describe("audioCacheKey", () => {
  const engine = ttsEngine("minimax");
  const input: TtsInput = {
    text: "第一句话。",
    voice: "v1",
    model: "m1",
    rate: 1,
    language: "zh-CN",
  };
  const config = { ...EMPTY_TTS_CONFIG, values: { apiKey: "k1", site: "cn" } };

  it("is the same for the same sentence and settings", async () => {
    expect(await audioCacheKey(engine, input, config)).toBe(
      await audioCacheKey(engine, input, config),
    );
  });

  it("changes with anything that changes the audio", async () => {
    const base = await audioCacheKey(engine, input, config);
    for (const other of [
      { ...input, text: "第二句话。" },
      { ...input, voice: "v2" },
      { ...input, model: "m2" },
      { ...input, rate: 1.2 },
      { ...input, language: "ja-JP" },
    ]) {
      expect(await audioCacheKey(engine, other, config)).not.toBe(base);
    }
    // A different engine, and a non-secret setting such as the site.
    expect(await audioCacheKey(ttsEngine("openai"), input, config)).not.toBe(base);
    const intl = { ...config, values: { ...config.values, site: "intl" } };
    expect(await audioCacheKey(engine, input, intl)).not.toBe(base);
    // The custom engine's request is part of the key.
    const custom = ttsEngine("custom");
    const one = { ...EMPTY_TTS_CONFIG, request: { ...EMPTY_TEMPLATE, url: "https://a.test" } };
    const two = { ...EMPTY_TTS_CONFIG, request: { ...EMPTY_TEMPLATE, url: "https://b.test" } };
    expect(await audioCacheKey(custom, input, one)).not.toBe(
      await audioCacheKey(custom, input, two),
    );
  });

  it("ignores a replaced key, which speaks exactly the same", async () => {
    const rotated = { ...config, values: { ...config.values, apiKey: "k2" } };
    expect(await audioCacheKey(engine, input, rotated)).toBe(
      await audioCacheKey(engine, input, config),
    );
  });
});
