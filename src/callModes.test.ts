import { describe, expect, it } from "vitest";
import {
  type CallMode,
  defaultModes,
  describeDays,
  describeMode,
  describeRanges,
  describeRingState,
  formatChange,
  isRingAllowed,
  modeProblem,
  normalizeModes,
  normalizeOnIds,
  ringSchedule,
  switchOn,
  WEEK,
} from "./callModes.ts";

const work: CallMode = {
  id: "work",
  name: "工作",
  rule: "ringOnly",
  ranges: [{ start: "10:00", end: "19:00" }],
  days: [...WEEK],
};
const sleep: CallMode = {
  id: "sleep",
  name: "睡眠",
  rule: "quiet",
  ranges: [{ start: "22:00", end: "08:00" }],
  days: [...WEEK],
};
const weekdays: CallMode = { ...work, id: "weekdays", name: "上班", days: [1, 2, 3, 4, 5] };
const weekend: CallMode = {
  id: "weekend",
  name: "周末",
  rule: "ringOnly",
  ranges: [{ start: "12:00", end: "14:00" }],
  days: [6, 0],
};
// 2026-09-28 is a Monday; 10-03 a Saturday, 10-04 a Sunday.
const at = (hhmm: string, date = "09-28") => new Date(`2026-${date}T${hhmm}:00`);

describe("isRingAllowed", () => {
  it("always rings without a mode", () => {
    expect(isRingAllowed([], at("03:00"))).toBe(true);
  });

  it("工作 rings only from 10:00 until 19:00", () => {
    expect(isRingAllowed([work], at("09:59"))).toBe(false);
    expect(isRingAllowed([work], at("10:00"))).toBe(true);
    expect(isRingAllowed([work], at("18:59"))).toBe(true);
    expect(isRingAllowed([work], at("19:00"))).toBe(false);
  });

  it("睡眠 is silent from 22:00 across midnight until 08:00", () => {
    expect(isRingAllowed([sleep], at("21:59"))).toBe(true);
    expect(isRingAllowed([sleep], at("22:00"))).toBe(false);
    expect(isRingAllowed([sleep], at("03:00"))).toBe(false);
    expect(isRingAllowed([sleep], at("08:00"))).toBe(true);
  });

  it("rings in any of several ranges", () => {
    const split = { ...work, ranges: [...work.ranges, { start: "20:00", end: "21:00" }] };
    expect(isRingAllowed([split], at("20:30"))).toBe(true);
    expect(isRingAllowed([split], at("19:30"))).toBe(false);
  });

  it("follows each day's own mode, and rings any time on a day without one", () => {
    expect(isRingAllowed([weekdays, weekend], at("11:00"))).toBe(true);
    expect(isRingAllowed([weekdays, weekend], at("11:00", "10-03"))).toBe(false);
    expect(isRingAllowed([weekdays, weekend], at("13:00", "10-04"))).toBe(true);
    expect(isRingAllowed([weekdays], at("03:00", "10-03"))).toBe(true);
  });
});

describe("ringSchedule", () => {
  it("finds when ringing starts again", () => {
    expect(ringSchedule([sleep], at("23:15"))).toEqual({
      allowed: false,
      nextChange: at("08:00", "09-29"),
      mode: sleep,
    });
    expect(ringSchedule([work], at("09:30"))).toMatchObject({
      allowed: false,
      nextChange: at("10:00"),
    });
    expect(ringSchedule([work], at("12:00"))).toMatchObject({
      allowed: true,
      nextChange: at("19:00"),
    });
  });

  it("never changes without a mode", () => {
    expect(ringSchedule([], at("12:00"))).toEqual({ allowed: true, nextChange: null, mode: null });
  });

  it("looks past the days without a mode", () => {
    // Friday 19:00 stops ringing; Saturday and Sunday have no mode, so it rings from 00:00.
    expect(ringSchedule([weekdays], at("20:00", "10-02"))).toEqual({
      allowed: false,
      nextChange: at("00:00", "10-03"),
      mode: weekdays,
    });
    // Saturday rings all day until Monday 00:00, which is outside 上班's 10:00–19:00.
    expect(ringSchedule([weekdays], at("12:00", "10-03"))).toMatchObject({
      allowed: true,
      nextChange: at("00:00", "10-05"),
      mode: null,
    });
  });
});

describe("modes on", () => {
  it("switching a mode on turns off only the ones sharing a day with it", () => {
    const modes = [work, weekdays, weekend];
    expect(switchOn(modes, ["weekdays"], weekend)).toEqual(["weekdays", "weekend"]);
    expect(switchOn(modes, ["weekdays", "weekend"], work)).toEqual(["work"]);
    expect(switchOn(modes, ["weekend"], weekdays)).toEqual(["weekend", "weekdays"]);
  });

  it("keeps stored ids that exist, one mode per day", () => {
    const modes = [work, weekdays, weekend];
    expect(normalizeOnIds(modes, ["weekdays", "gone", "work", "weekend", "weekend"])).toEqual([
      "weekdays",
      "weekend",
    ]);
    expect(normalizeOnIds(modes, null)).toEqual([]);
  });
});

describe("modes", () => {
  it("describes a mode in one line", () => {
    expect(describeMode(work)).toBe("10:00–19:00 响铃");
    expect(describeMode(sleep)).toBe("22:00–08:00 不响铃");
  });

  it("names the 重复 days", () => {
    expect(describeDays([...WEEK])).toBe("每天");
    expect(describeDays([5, 1, 2, 3, 4])).toBe("工作日");
    expect(describeDays([0, 6])).toBe("周末");
    expect(describeDays([5, 1, 3])).toBe("周一、周三、周五");
  });

  it("rejects modes that cannot be saved", () => {
    expect(modeProblem({ ...work, name: " " })).toBe("请填写模式名称");
    expect(modeProblem({ ...work, ranges: [] })).toMatch("至少要有一个时段");
    expect(modeProblem({ ...work, days: [] })).toMatch("至少要选一天");
    expect(modeProblem({ ...work, ranges: [{ start: "10:00", end: "" }] })).toMatch("填完整");
    expect(modeProblem({ ...work, ranges: [{ start: "10:00", end: "10:00" }] })).toMatch(
      "不能相同",
    );
    expect(modeProblem(work)).toBeNull();
  });

  it("starts with 工作 on weekdays and 睡眠 every day, and keeps a saved empty list empty", () => {
    expect(normalizeModes(undefined)).toEqual(defaultModes());
    expect(defaultModes().map((m) => describeDays(m.days))).toEqual(["工作日", "每天"]);
    expect(normalizeModes([])).toEqual([]);
  });

  it("drops malformed stored modes", () => {
    expect(
      normalizeModes([work, { id: "x", name: "坏", rule: "never", ranges: [] }, null]),
    ).toEqual([work]);
  });

  it("uses a mode saved before 重复 existed every day", () => {
    const { days: _, ...old } = weekend;
    expect(normalizeModes([old])[0]?.days).toEqual(WEEK);
    expect(normalizeModes([{ ...weekend, days: [0, 9, 6] }])[0]?.days).toEqual([6, 0]);
  });

  it("describes ranges and whether calls ring now", () => {
    const now = at("20:30");
    expect(describeRanges(work)).toBe("10:00–19:00");
    expect(describeRingState(ringSchedule([], now), now)).toBe("来电随时响铃");
    expect(describeRingState(ringSchedule([work], now), now)).toBe(
      "现在不响铃，来电记为未接，明天 10:00 起响铃",
    );
    const noon = at("12:00");
    expect(describeRingState(ringSchedule([work], noon), noon)).toBe(
      "现在来电会响铃，19:00 起不响铃",
    );
  });

  it("names the day of a change later in the week", () => {
    expect(formatChange(at("10:00", "10-01"), at("20:00"))).toBe("周四 10:00");
  });
});
