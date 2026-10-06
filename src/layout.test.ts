import { describe, expect, it } from "vitest";
import {
  callPanes,
  EXPANDED_MIN,
  isTwoPane,
  type LayoutClass,
  layoutClassOf,
  MEDIUM_MIN,
} from "./layout.ts";

/** CSS 宽度（物理分辨率 ÷ DPR），不是物理分辨率。 */
const PHONES: [string, number][] = [
  ["iPhone SE", 320],
  ["小米 / 红米常见", 360],
  ["iPhone 13 mini", 375],
  ["iPhone 15 / 16", 393],
  ["Pixel 8", 412],
  ["iPhone 15 Pro Max", 430],
];

describe("layoutClassOf", () => {
  it("分三档，断点是 Material 3 的 600 / 840", () => {
    expect(layoutClassOf(599)).toBe("compact");
    expect(layoutClassOf(MEDIUM_MIN)).toBe("medium");
    expect(layoutClassOf(839)).toBe("medium");
    expect(layoutClassOf(EXPANDED_MIN)).toBe("expanded");
    expect(layoutClassOf(1440)).toBe("expanded");
  });

  it("普通手机全部落在 compact，不需要为它们写特例", () => {
    for (const [model, width] of PHONES) {
      expect(layoutClassOf(width), model).toBe("compact");
    }
  });

  it("阔折叠折起 353 和普通手机同一档，展开 781 才分栏", () => {
    expect(layoutClassOf(353)).toBe("compact");
    expect(layoutClassOf(781)).toBe("medium");
  });

  it("PC 窗口：Tauri 最小 360 和默认 420 保持单栏，拉宽后才分栏", () => {
    expect(layoutClassOf(360)).toBe("compact");
    expect(layoutClassOf(420)).toBe("compact");
    expect(layoutClassOf(1100)).toBe("expanded");
    expect(layoutClassOf(1440)).toBe("expanded");
  });

  it("平板竖屏按宽度落到 medium：宽度够就分栏，不看是不是触屏", () => {
    expect(layoutClassOf(744)).toBe("medium"); // iPad mini
    expect(layoutClassOf(834)).toBe("medium"); // iPad Pro 11
  });

  it("宽度为 0（还没量到）时按单栏算，不会先闪一下两栏", () => {
    expect(layoutClassOf(0)).toBe("compact");
  });
});

describe("callPanes", () => {
  it("单栏只有通话界面，宽屏多出汇报原文", () => {
    expect(callPanes("compact", false)).toEqual({ stage: true, raw: false });
    expect(callPanes("medium", false)).toEqual({ stage: true, raw: true });
    expect(callPanes("expanded", false)).toEqual({ stage: true, raw: true });
  });

  it("简报生成失败、卡片里已经是原文时不再出右栏：同一段文字不显示两份", () => {
    expect(callPanes("medium", true).raw).toBe(false);
    expect(callPanes("expanded", true).raw).toBe(false);
  });

  it("通话界面这一栏永远在，任何档位都不会只剩原文", () => {
    for (const layout of ["compact", "medium", "expanded"] as LayoutClass[]) {
      expect(callPanes(layout, false).stage, layout).toBe(true);
      expect(callPanes(layout, true).stage, layout).toBe(true);
    }
  });
});

describe("isTwoPane", () => {
  it("只有 compact 是单栏", () => {
    const cases: [LayoutClass, boolean][] = [
      ["compact", false],
      ["medium", true],
      ["expanded", true],
    ];
    for (const [layout, two] of cases) expect(isTwoPane(layout), layout).toBe(two);
  });
});
