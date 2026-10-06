import { t } from "./i18n/index.ts";

/** A daily time range, local time, "HH:MM". `end` before `start` crosses midnight (22:00–08:00). */
export interface TimeRange {
  start: string;
  end: string;
}

/** A day of the week as `Date.getDay()`: 0 is Sunday, 6 Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The week as it is shown, Monday first. */
export const WEEK: Weekday[] = [1, 2, 3, 4, 5, 6, 0];

/** "一" … "日" / "M" … "S": one day on the 重复 picker. */
export function dayChar(day: Weekday): string {
  return t().modes.dayShort[day];
}

/** "周一" / "Mon". */
export function dayName(day: Weekday): string {
  return t().modes.dayName[day];
}

/**
 * A named ringing schedule, e.g. 工作 (rings 10:00–19:00 only) or 睡眠 (silent 22:00–08:00).
 * `ringOnly`: calls ring only inside `ranges`. `quiet`: calls never ring inside `ranges`.
 * Outside the ringing time reports wait in the queue and ring once it starts.
 *
 * `days`: the days of the week it is used on, like an alarm's 重复. Several modes may be on as long
 * as no day has two; each day follows its own mode from 00:00 to 24:00, so a range across midnight
 * such as 22:00–08:00 means 00:00–08:00 and 22:00–24:00 of that day. A day with no mode on always
 * rings.
 */
export interface CallMode {
  id: string;
  name: string;
  rule: "ringOnly" | "quiet";
  ranges: TimeRange[];
  days: Weekday[];
}

export const MODE_NAME_MAX = 12;

/**
 * Modes on a fresh install, taken from the examples in YOUT-192, named in the current language.
 * None is on until picked.
 */
export function defaultModes(): CallMode[] {
  const { defaultName } = t().modes;
  return [
    {
      id: "work",
      name: defaultName.work,
      rule: "ringOnly",
      ranges: [{ start: "10:00", end: "19:00" }],
      days: [1, 2, 3, 4, 5],
    },
    {
      id: "sleep",
      name: defaultName.sleep,
      rule: "quiet",
      ranges: [{ start: "22:00", end: "08:00" }],
      days: [...WEEK],
    },
  ];
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTime(value: unknown): value is string {
  return typeof value === "string" && TIME.test(value);
}

function minutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function inRange(minuteOfDay: number, r: TimeRange): boolean {
  const start = minutes(r.start);
  const end = minutes(r.end);
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

/** Of the modes that are on, the one used on `at`'s day of the week; null: 随时响铃. */
export function modeOn(on: CallMode[], at: Date): CallMode | null {
  return on.find((m) => m.days.includes(at.getDay() as Weekday)) ?? null;
}

/** Whether a call may ring at `now` with the modes that are on; a day without one always rings. */
export function isRingAllowed(on: CallMode[], now: Date): boolean {
  const mode = modeOn(on, now);
  if (!mode) return true;
  const m = now.getHours() * 60 + now.getMinutes();
  const inside = mode.ranges.some((r) => inRange(m, r));
  return mode.rule === "ringOnly" ? inside : !inside;
}

export interface RingSchedule {
  allowed: boolean;
  /** When `allowed` flips next, within a week; null when it never does. */
  nextChange: Date | null;
  /** The mode deciding now; null: none is on today (随时响铃). */
  mode: CallMode | null;
}

export function ringSchedule(on: CallMode[], now: Date): RingSchedule {
  const allowed = isRingAllowed(on, now);
  const mode = modeOn(on, now);
  if (on.length === 0) return { allowed, nextChange: null, mode };
  const t = new Date(now);
  t.setSeconds(0, 0);
  for (let i = 0; i < 7 * 24 * 60; i++) {
    t.setMinutes(t.getMinutes() + 1);
    if (isRingAllowed(on, t) !== allowed) return { allowed, nextChange: new Date(t), mode };
  }
  return { allowed, nextChange: null, mode };
}

/** The modes whose ids are in `onIds`, in list order. */
export function modesOn(modes: CallMode[], onIds: string[]): CallMode[] {
  return modes.filter((m) => onIds.includes(m.id));
}

function sharesDay(a: CallMode, b: CallMode): boolean {
  return a.days.some((d) => b.days.includes(d));
}

/** Modes that are on and share a day with `mode`: switching `mode` on turns them off. */
export function clashes(modes: CallMode[], onIds: string[], mode: CallMode): CallMode[] {
  return modesOn(modes, onIds).filter((m) => m.id !== mode.id && sharesDay(m, mode));
}

/** `onIds` with `mode` switched on, and any mode sharing a day with it switched off. */
export function switchOn(modes: CallMode[], onIds: string[], mode: CallMode): string[] {
  const off = clashes(modes, onIds, mode).map((m) => m.id);
  return [...onIds.filter((id) => id !== mode.id && !off.includes(id)), mode.id];
}

/** Stored ids of the modes that are on: only existing ones, and one per day (the first wins). */
export function normalizeOnIds(modes: CallMode[], stored: unknown): string[] {
  if (!Array.isArray(stored)) return [];
  const on: string[] = [];
  for (const id of stored) {
    const mode = modes.find((m) => m.id === id);
    if (mode && !on.includes(mode.id) && clashes(modes, on, mode).length === 0) on.push(mode.id);
  }
  return on;
}

/** "每天" / "工作日" / "周末" / "周一、周三、周五". */
export function describeDays(days: Weekday[]): string {
  const m = t().modes;
  const shown = WEEK.filter((d) => days.includes(d));
  if (shown.length === 7) return m.everyDay;
  if (shown.join() === "1,2,3,4,5") return m.weekdays;
  if (shown.join() === "6,0") return m.weekend;
  return shown.map(dayName).join(t().common.listSep);
}

/** "10:00–19:00" / "22:00–08:00、12:00–13:00". */
export function describeRanges(mode: CallMode): string {
  return mode.ranges.map((r) => `${r.start}–${r.end}`).join(t().common.listSep);
}

/** "10:00–19:00 响铃" / "22:00–08:00 不响铃". */
export function describeMode(mode: CallMode): string {
  const m = t().modes;
  return `${describeRanges(mode)} ${mode.rule === "ringOnly" ? m.rings : m.silent}`;
}

/** "现在来电会响铃，19:00 起不响铃" and the like; "来电随时响铃" when that never changes. */
export function describeRingState(schedule: RingSchedule, now: Date): string {
  const m = t().modes;
  if (schedule.allowed && !schedule.nextChange) return m.ringsAnyTime;
  const change = schedule.nextChange && formatChange(schedule.nextChange, now);
  return schedule.allowed ? m.ringingNow(change) : m.silentNow(change);
}

/** A problem that keeps `mode` from being saved, or null. */
export function modeProblem(mode: CallMode): string | null {
  const p = t().modes.problem;
  if (!mode.name.trim()) return p.noName;
  if (mode.ranges.length === 0) return p.noRange(mode.name);
  if (mode.days.length === 0) return p.noDay(mode.name);
  for (const r of mode.ranges) {
    if (!isTime(r.start) || !isTime(r.end)) return p.incomplete(mode.name);
    if (r.start === r.end) return p.sameEnds(mode.name);
  }
  return null;
}

/** Stored modes, keeping only well-formed ones; nothing stored yet means the defaults. */
export function normalizeModes(stored: unknown): CallMode[] {
  if (!Array.isArray(stored)) return defaultModes();
  return stored.flatMap((m): CallMode[] => {
    if (!m || typeof m !== "object") return [];
    const { id, name, rule, ranges, days } = m as Partial<CallMode>;
    if (typeof id !== "string" || !id || typeof name !== "string") return [];
    if (rule !== "ringOnly" && rule !== "quiet") return [];
    const mode: CallMode = {
      id,
      name: name.trim().slice(0, MODE_NAME_MAX),
      rule,
      ranges: Array.isArray(ranges)
        ? ranges.filter((r) => isTime(r?.start) && isTime(r?.end) && r.start !== r.end)
        : [],
      // Modes saved before 重复 existed were used every day.
      days: Array.isArray(days) ? WEEK.filter((d) => days.includes(d)) : [...WEEK],
    };
    return modeProblem(mode) ? [] : [mode];
  });
}

/** "08:00" today, "明天 08:00" tomorrow, "周一 08:00" later in the week. */
export function formatChange(at: Date, now: Date): string {
  const hhmm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (at.toDateString() === now.toDateString()) return hhmm;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const m = t().modes;
  return at.toDateString() === tomorrow.toDateString()
    ? m.tomorrowAt(hhmm)
    : m.dayAt(dayName(at.getDay() as Weekday), hhmm);
}
