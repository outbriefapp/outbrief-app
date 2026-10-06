import { afterEach, describe, expect, it } from "vitest";
import { defaultModes, describeDays, describeRingState, formatChange } from "../callModes.ts";
import { callerSubtitle, statusLabel } from "../format.ts";
import { resolveSettings } from "../settings.ts";
import { en } from "./en.ts";
import { resolveLocale, setLocale, systemLocale, t } from "./index.ts";
import { zh } from "./zh.ts";

afterEach(() => setLocale("zh"));

describe("locale", () => {
  it("follows the system's first language: any Chinese is 中文, anything else English", () => {
    expect(systemLocale(["zh-CN", "en-US"])).toBe("zh");
    expect(systemLocale(["zh-Hant-TW"])).toBe("zh");
    expect(systemLocale(["en-US", "zh-CN"])).toBe("en");
    expect(systemLocale(["ja-JP"])).toBe("en");
    expect(systemLocale([])).toBe("en");
  });

  it("uses a chosen language whatever the system is", () => {
    expect(resolveLocale("zh", () => "en")).toBe("zh");
    expect(resolveLocale("en", () => "zh")).toBe("en");
    expect(resolveLocale("system", () => "en")).toBe("en");
  });

  it("names the product 启奏 in Chinese and keeps OutBrief in English", () => {
    expect(zh.productName).toBe("启奏");
    expect(en.productName).toBe("OutBrief");
  });

  it("switches the texts helpers build", () => {
    const now = new Date(2026, 8, 28, 9, 0);
    const schedule = { allowed: true, nextChange: new Date(2026, 8, 29, 22, 0), mode: null };
    expect(describeRingState(schedule, now)).toBe("现在来电会响铃，明天 22:00 起不响铃");
    expect(describeDays([1, 3])).toBe("周一、周三");
    setLocale("en");
    expect(t()).toBe(en);
    expect(describeRingState(schedule, now)).toBe("Calls ring now, silent from tomorrow 22:00");
    expect(describeDays([1, 3])).toBe("Mon, Wed");
    expect(formatChange(new Date(2026, 9, 1, 8, 0), now)).toBe("Thu 08:00");
    expect(statusLabel("dismissed")).toBe("Declined");
    expect(callerSubtitle({ source: "generic" } as Parameters<typeof callerSubtitle>[0])).toBe(
      "Task report",
    );
  });

  it("names the default modes in the language of a fresh install", () => {
    expect(defaultModes().map((m) => m.name)).toEqual(["工作", "睡眠"]);
    setLocale("en");
    expect(defaultModes().map((m) => m.name)).toEqual(["Work", "Sleep"]);
  });
});

describe("language setting", () => {
  it("follows the system until one is chosen, and ignores unknown values", () => {
    expect(resolveSettings(null).language).toBe("system");
    expect(resolveSettings({ language: "en" }).language).toBe("en");
    expect(resolveSettings({ language: "fr" }).language).toBe("system");
  });
});
