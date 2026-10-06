import { describe, expect, it } from "vitest";
import { AZURE_LANGUAGES, AZURE_VOICE_NAMES } from "./azureVoices.ts";
import {
  degradedSpeech,
  previewText,
  resolveSpeechLanguage,
  SPEECH_LANGUAGES,
  speechLanguagePromptName,
  systemSpeechLanguage,
} from "./languages.ts";
import { DEFAULT_VOICE, defaultVoice, speechVoice, voiceGroupsOf, voiceLabel } from "./voices.ts";

describe("Azure languages", () => {
  it("offers the plugin's Azure languages, each with voices, names and phrases", () => {
    expect(SPEECH_LANGUAGES.length).toBe(90);
    for (const language of SPEECH_LANGUAGES) {
      const groups = voiceGroupsOf(language);
      expect(groups.length).toBeGreaterThan(0);
      for (const v of groups.flatMap((g) => g.voices)) {
        expect(AZURE_VOICE_NAMES[v.id]).toBeDefined();
        expect(v.id).not.toMatch(/DragonHD|XiaoxuanNeural/);
      }
      expect(AZURE_LANGUAGES[language]?.name.zh).toBeTruthy();
      expect(AZURE_LANGUAGES[language]?.name.en).toBeTruthy();
      expect(previewText(language)).toBeTruthy();
      expect(degradedSpeech(language)).toBeTruthy();
      expect(speechLanguagePromptName(language)).not.toBe(language);
    }
  });

  it("speaks Traditional Chinese for Taiwan and Hong Kong", () => {
    expect(previewText("zh-CN")).toContain("启奏");
    expect(previewText("zh-TW")).toContain("啟奏");
    expect(previewText("zh-HK")).toContain("啟奏");
    expect(speechLanguagePromptName("zh-TW")).toBe("中文（繁体，台湾）");
    expect(speechLanguagePromptName("es-MX")).toBe("墨西哥西班牙语");
  });
});

describe("speechVoice", () => {
  it("keeps the saved voice for its language and uses the language's first voice otherwise", () => {
    expect(defaultVoice("zh-CN")).toBe(DEFAULT_VOICE);
    expect(speechVoice("zh-CN-YunfengNeural", "zh-CN")).toBe("zh-CN-YunfengNeural");
    expect(speechVoice("yue-CN-XiaoMinNeural", "zh-CN")).toBe("yue-CN-XiaoMinNeural");
    expect(speechVoice("zh-CN-YunfengNeural", "ja-JP")).toBe(defaultVoice("ja-JP"));
    expect(speechVoice("retired-voice", "zh-CN")).toBe(DEFAULT_VOICE);
    // A multilingual voice offered for another language counts for it too.
    expect(speechVoice("en-US-AvaMultilingualNeural", "af-ZA")).toBe("en-US-AvaMultilingualNeural");
  });

  it("names a voice in its own language only for its own locale, as the plugin does", () => {
    expect(voiceLabel("zh-CN-XiaoxiaoMultilingualNeural", "zh-CN")).toBe("晓晓 多语言");
    expect(voiceLabel("zh-CN-XiaoxiaoMultilingualNeural", "af-ZA")).toBe("Xiaoxiao Multilingual");
  });
});

describe("speech language", () => {
  it("follows the first system language offered, by region or where it is most spoken", () => {
    expect(systemSpeechLanguage(["zh-Hans-CN", "en-US"])).toBe("zh-CN");
    expect(systemSpeechLanguage(["zh-Hant"])).toBe("zh-TW");
    expect(systemSpeechLanguage(["pt"])).toBe("pt-BR");
    expect(systemSpeechLanguage(["es-MX"])).toBe("es-MX");
    expect(systemSpeechLanguage(["xx", "de"])).toBe("de-DE");
    expect(systemSpeechLanguage(["xx"])).toBe("en-US");
    expect(resolveSpeechLanguage("system", () => "ko-KR")).toBe("ko-KR");
    expect(resolveSpeechLanguage("de-DE", () => "ko-KR")).toBe("de-DE");
  });
});
