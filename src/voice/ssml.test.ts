import { describe, expect, it } from "vitest";
import { buildSsml, prosodyRate } from "./ssml.ts";

describe("prosodyRate", () => {
  it("maps the multiplier to a signed percentage and clamps it", () => {
    expect(prosodyRate(1.2)).toBe("+20%");
    expect(prosodyRate(0.8)).toBe("-20%");
    expect(prosodyRate(1)).toBe("+0%");
    expect(prosodyRate(3)).toBe("+100%");
    expect(prosodyRate(0.1)).toBe("-50%");
  });
});

describe("buildSsml", () => {
  it("escapes XML, blanks control characters and nests voice > prosody > text", () => {
    const ssml = buildSsml(`a<b & "c" 'd'>\u0007e`, {
      voice: "zh-CN-YunxiNeural",
      rate: 1.2,
      language: "zh-CN",
    });
    expect(ssml).toBe(
      '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN">' +
        '<voice name="zh-CN-YunxiNeural"><prosody rate="+20%">' +
        "a&lt;b &amp; &quot;c&quot; &apos;d&apos;&gt; e</prosody></voice></speak>",
    );
  });

  it("wraps all-Latin text in <lang> only for multilingual voices", () => {
    const multi = buildSsml("Build passed.", {
      voice: "zh-CN-XiaoxiaoMultilingualNeural",
      rate: 1,
      language: "zh-CN",
    });
    expect(multi).toContain(
      '<lang xml:lang="en-US"><prosody rate="+0%">Build passed.</prosody></lang>',
    );
    expect(
      buildSsml("Build passed.", { voice: "zh-CN-XiaoxiaoNeural", rate: 1, language: "zh-CN" }),
    ).not.toContain("<lang");
    expect(
      buildSsml("构建 passed 了。", {
        voice: "zh-CN-XiaoxiaoMultilingualNeural",
        rate: 1,
        language: "zh-CN",
      }),
    ).not.toContain("<lang");
  });

  it("leaves Latin-script voices on their own language", () => {
    for (const voice of ["fr-FR-VivienneMultilingualNeural", "en-US-AvaMultilingualNeural"]) {
      expect(
        buildSsml("Le build est passé.", { voice, rate: 1, language: voice.slice(0, 5) }),
      ).not.toContain("<lang");
    }
    expect(
      buildSsml("Build passed.", {
        voice: "ja-JP-MasaruMultilingualNeural",
        rate: 1,
        language: "ja-JP",
      }),
    ).toContain('<lang xml:lang="en-US">');
  });

  it("tells a multilingual voice of another locale to speak the call language", () => {
    const ssml = buildSsml("Hallo daar.", {
      voice: "en-US-AvaMultilingualNeural",
      rate: 1,
      language: "af-ZA",
    });
    expect(ssml).toContain(
      'xml:lang="en-US"><voice name="en-US-AvaMultilingualNeural"><lang xml:lang="af-ZA">',
    );
    // A plain voice cannot switch; wuu-CN under zh-CN just speaks Wu.
    expect(
      buildSsml("你好", { voice: "wuu-CN-XiaotongNeural", rate: 1, language: "zh-CN" }),
    ).not.toContain("<lang");
  });

  it("takes xml:lang from the voice's language-region prefix", () => {
    expect(
      buildSsml("你好", { voice: "wuu-CN-XiaotongNeural", rate: 1, language: "zh-CN" }),
    ).toContain('xml:lang="wuu-CN"><voice name="wuu-CN-XiaotongNeural">');
    expect(
      buildSsml("你好", { voice: "zh-CN-sichuan-YunxiNeural", rate: 1, language: "zh-CN" }),
    ).toContain('xml:lang="zh-CN"><voice name="zh-CN-sichuan-YunxiNeural">');
  });

  it("skips prosody for DragonHD voices", () => {
    const ssml = buildSsml("你好", {
      voice: "zh-CN-Xiaochen:DragonHDLatestNeural",
      rate: 1.5,
      language: "zh-CN",
    });
    expect(ssml).toContain('<voice name="zh-CN-Xiaochen:DragonHDLatestNeural">你好</voice>');
  });

  it("rejects text that is empty after sanitizing", () => {
    expect(() =>
      buildSsml(" \u0001 ", { voice: "zh-CN-YunxiNeural", rate: 1, language: "zh-CN" }),
    ).toThrow();
  });
});
