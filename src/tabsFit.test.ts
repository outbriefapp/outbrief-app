import { describe, expect, it } from "vitest";
import { fitTabs } from "./tabsFit.ts";

describe("fitTabs", () => {
  it("shows every tab when they fit", () => {
    expect(fitTabs([50, 60, 70], 200, 5, 40, 0)).toEqual({ shown: [0, 1, 2], hidden: [] });
  });

  it("keeps as many tabs as fit next to the more button, in order", () => {
    // 50 + 5 + 60 = 115 ≤ 200 - 40 - 5; adding 70 does not fit.
    expect(fitTabs([50, 60, 70, 30], 200, 5, 40, 0)).toEqual({ shown: [0, 1], hidden: [2, 3] });
  });

  it("keeps the current tab in the row, in place of the last ones that fit", () => {
    expect(fitTabs([50, 60, 70, 30], 200, 5, 40, 2)).toEqual({ shown: [0, 2], hidden: [1, 3] });
    expect(fitTabs([50, 60, 70, 30], 200, 5, 40, 3)).toEqual({
      shown: [0, 1, 3],
      hidden: [2],
    });
  });

  it("still shows the current tab when nothing else fits", () => {
    expect(fitTabs([300, 300], 200, 5, 40, 1)).toEqual({ shown: [1], hidden: [0] });
  });
});
