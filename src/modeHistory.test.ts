import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CallMode, isRingAllowed, WEEK } from "./callModes.ts";
import { loadModeHistory, modesAt, rememberModes, withModes } from "./modeHistory.ts";

const sleep: CallMode = {
  id: "sleep",
  name: "睡眠",
  rule: "quiet",
  ranges: [{ start: "22:00", end: "08:00" }],
  days: [...WEEK],
};
const DAY = 24 * 60 * 60 * 1000;

describe("modesAt", () => {
  const night = new Date(2026, 9, 7, 3, 0).getTime();
  const morning = new Date(2026, 9, 7, 7, 30).getTime();
  const history = withModes(withModes([], [sleep], night - DAY), [], morning);

  it("gives the modes on when the call was received", () => {
    expect(modesAt(history, night)).toEqual([sleep]);
    expect(modesAt(history, morning + 1)).toEqual([]);
  });

  it("keeps a call received in 睡眠 missed after 睡眠 is switched off (OUTB-58)", () => {
    const on = modesAt(history, night) ?? [];
    expect(isRingAllowed(on, new Date(night))).toBe(false);
  });

  it("knows nothing before the first switch", () => {
    expect(modesAt(history, night - 2 * DAY)).toBeNull();
  });
});

describe("withModes", () => {
  it("adds nothing when the modes did not change", () => {
    const history = withModes([], [sleep], 1);
    expect(withModes(history, [{ ...sleep }], 2)).toBe(history);
  });

  it("drops switches older than a week but the one still in effect then", () => {
    const now = 30 * DAY;
    let history = withModes([], [sleep], now - 10 * DAY);
    history = withModes(history, [], now - 9 * DAY);
    history = withModes(history, [sleep], now - DAY);
    history = withModes(history, [], now);
    expect(history.map((e) => e.since)).toEqual([now - 9 * DAY, now - DAY, now]);
  });
});

describe("rememberModes", () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
    });
  });

  it("keeps the history across reloads", () => {
    rememberModes([sleep], 1);
    rememberModes([sleep], 2);
    rememberModes([], 3);
    expect(loadModeHistory()).toEqual([
      { since: 1, modes: [sleep] },
      { since: 3, modes: [] },
    ]);
  });
});
