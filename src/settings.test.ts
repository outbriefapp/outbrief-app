import { describe, expect, it } from "vitest";
import {
  activeModes,
  DEFAULT_ADDRESS_NAME,
  normalizeAddressName,
  resolveSettings,
  serverOf,
} from "./settings.ts";

describe("resolveSettings", () => {
  it("keeps the saved account over the env defaults", () => {
    const settings = resolveSettings(
      {
        serverUrl: "http://localhost:8787",
        token: "oba_device",
        accountId: "acc-1",
        deviceId: "dev-1",
        voice: "zh-CN-XiaoxiaoNeural",
        rate: 1.2,
      },
      { serverUrl: "http://example.test" },
    );
    expect(settings).toMatchObject({
      serverUrl: "http://localhost:8787",
      token: "oba_device",
      accountId: "acc-1",
      deviceId: "dev-1",
      rate: 1.2,
    });
    expect(serverOf(settings)).toEqual({
      serverUrl: "http://localhost:8787",
      token: "oba_device",
    });
  });

  it("drops the shared token of old versions: the device joins an account instead", () => {
    const upgraded = resolveSettings(
      {
        serverUrl: "http://localhost:8787",
        token: "0123456789abcdef0123456789abcdef",
        e2eKey: "k",
      },
      {},
    );
    expect(upgraded).toMatchObject({ token: "", accountId: "", deviceId: "", e2eKey: "k" });
    expect(serverOf(upgraded)).toBeNull();
  });

  it("keeps the speaking rate within Azure's 0.5–2× prosody range", () => {
    expect(resolveSettings({ rate: 0.5 }, {}).rate).toBe(0.5);
    expect(resolveSettings({ rate: 2 }, {}).rate).toBe(2);
    expect(resolveSettings({ rate: 0.3 }, {}).rate).toBe(0.5);
    expect(resolveSettings({ rate: 3 }, {}).rate).toBe(2);
  });

  it("follows the system's language for calls until one is chosen", () => {
    expect(resolveSettings(null, {}).speechLanguage).toBe("system");
    expect(resolveSettings({ speechLanguage: "ja-JP" }, {}).speechLanguage).toBe("ja-JP");
    expect(resolveSettings({ speechLanguage: "ja" }, {}).speechLanguage).toBe("system");
  });

  it("speaks with Azure until another engine is saved, keeping an old Azure voice", () => {
    expect(resolveSettings(null, {}).tts).toEqual({ engine: "azure", configs: {} });
    const old = resolveSettings({ voice: "zh-CN-XiaoxiaoNeural" }, {});
    expect(old.tts.engine).toBe("azure");
    expect(old.tts.configs.azure?.voice).toBe("zh-CN-XiaoxiaoNeural");
    expect(resolveSettings({ tts: { engine: "edge" } }, {}).tts.engine).toBe("azure");
    const saved = resolveSettings(
      {
        voice: "zh-CN-XiaoxiaoNeural",
        tts: {
          engine: "minimax",
          configs: { minimax: { values: { apiKey: "k", n: 1 }, model: "m", voice: "v" } },
        },
      },
      {},
    );
    expect(saved.tts.engine).toBe("minimax");
    expect(saved.tts.configs.minimax).toEqual({ values: { apiKey: "k" }, model: "m", voice: "v" });
    expect(saved.tts.configs.azure?.voice).toBe("zh-CN-XiaoxiaoNeural");
  });

  it("drops a session token left by the old Google login", () => {
    const settings = resolveSettings(
      {
        serverUrl: "http://127.0.0.1:8787",
        token: "obu_session",
        user: { id: "u1", email: "ada@gmail.com" },
      },
      {},
    );
    expect(settings.token).toBe("");
    expect(serverOf(settings)).toBeNull();
  });

  it("is not connected without a token or a valid address", () => {
    expect(serverOf(resolveSettings(null, {}))).toBeNull();
    expect(serverOf(resolveSettings({ serverUrl: "localhost", token: "oba_t" }, {}))).toBeNull();
  });

  it("uses the env server address only when nothing is saved", () => {
    expect(resolveSettings(null, { serverUrl: "http://10.0.0.8:8787" })).toMatchObject({
      serverUrl: "http://10.0.0.8:8787",
      token: "",
    });
    expect(resolveSettings(null, {})).toMatchObject({
      serverUrl: "http://localhost:8787",
      token: "",
    });
  });

  it("fills the LLM endpoint from env only until one is saved", () => {
    const env = {
      llm: { baseUrl: " http://127.0.0.1:18317/v1 ", apiKey: "sk-env", model: "gemini-3.8-flash" },
    };
    expect(resolveSettings(null, env).llm).toEqual({
      baseUrl: "http://127.0.0.1:18317/v1",
      apiKey: "sk-env",
      model: "gemini-3.8-flash",
      structuredOutput: "json_schema",
    });
    expect(resolveSettings(null, {}).llm).toEqual({
      baseUrl: "",
      apiKey: "",
      model: "",
      structuredOutput: "json_schema",
    });
    // A saved endpoint is kept as a whole, even with the key cleared.
    const saved = { llm: { baseUrl: "https://ai-gateway.vercel.sh/v1", apiKey: "", model: "m" } };
    expect(resolveSettings(saved, env).llm).toEqual({
      ...saved.llm,
      structuredOutput: "json_schema",
    });
    const deepseek = { ...saved.llm, structuredOutput: "json_object" as const };
    expect(resolveSettings({ llm: deepseek }, env).llm.structuredOutput).toBe("json_object");
    expect(resolveSettings({ llm: { baseUrl: "", apiKey: " ", model: "" } }, env).llm.apiKey).toBe(
      "sk-env",
    );
  });

  it("drops the old server model choice", () => {
    const stored = JSON.parse('{"model":"gemini-3.8-flash"}');
    expect(resolveSettings(stored, {})).not.toHaveProperty("model");
  });

  it("defaults the 称呼 and keeps a saved one", () => {
    expect(resolveSettings(null, {}).addressName).toBe(DEFAULT_ADDRESS_NAME);
    expect(resolveSettings({ addressName: " 李哥 " }, {}).addressName).toBe("李哥");
    expect(normalizeAddressName("   ")).toBe(DEFAULT_ADDRESS_NAME);
    expect(normalizeAddressName("a".repeat(30))).toHaveLength(20);
  });
});

describe("modes in settings", () => {
  it("turns the one mode saved before 重复 existed into the list of modes on", () => {
    expect(resolveSettings({ activeModeId: "sleep" }, {}).activeModeIds).toEqual(["sleep"]);
    expect(resolveSettings({ activeModeId: "gone" }, {}).activeModeIds).toEqual([]);
    expect(resolveSettings(null, {}).activeModeIds).toEqual([]);
  });

  it("keeps several modes on when they are on different days", () => {
    const modes = [
      {
        id: "a",
        name: "上班",
        rule: "ringOnly",
        ranges: [{ start: "09:00", end: "18:00" }],
        days: [1, 2, 3, 4, 5],
      },
      {
        id: "b",
        name: "周末",
        rule: "quiet",
        ranges: [{ start: "22:00", end: "10:00" }],
        days: [6, 0],
      },
    ];
    const s = resolveSettings({ modes, activeModeIds: ["a", "b"] }, {});
    expect(activeModes(s).map((m) => m.name)).toEqual(["上班", "周末"]);
  });
});
