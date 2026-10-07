import { type CallMode, normalizeModes } from "./callModes.ts";

const KEY = "outbrief.modeHistory";
/** Switches kept for a week: a call older than that is long settled. */
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** From `since` (epoch ms) on, these modes were on, until the next entry. */
export interface ModesSince {
  since: number;
  modes: CallMode[];
}

/**
 * `history` with `on` taking effect at `now`; unchanged when those modes are already on. Entries
 * older than a week go, except the last one before it, which still covers that time.
 */
export function withModes(history: ModesSince[], on: CallMode[], now: number): ModesSince[] {
  const last = history.at(-1);
  if (last && JSON.stringify(last.modes) === JSON.stringify(on)) return history;
  const next = [...history, { since: now, modes: on }];
  const firstKept = next.findLastIndex((e) => e.since <= now - KEEP_MS);
  return firstKept > 0 ? next.slice(firstKept) : next;
}

/**
 * The modes that were on at `at`: a call is missed by the modes of the time it was received, not the
 * ones on when this device hears of it (OUTB-58). A phone that slept through the quiet time hears of
 * its calls only once its app runs again, possibly after 睡眠 was switched off. Null when `at` is
 * before the first switch this device saw.
 */
export function modesAt(history: ModesSince[], at: number): CallMode[] | null {
  return history.findLast((e) => e.since <= at)?.modes ?? null;
}

export function loadModeHistory(): ModesSince[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((e): ModesSince[] =>
      e && typeof e === "object" && typeof e.since === "number" && Array.isArray(e.modes)
        ? [{ since: e.since, modes: normalizeModes(e.modes) }]
        : [],
    );
  } catch {
    return [];
  }
}

/** Remembers that `on` are the modes from `now` on. */
export function rememberModes(on: CallMode[], now: number): void {
  const history = loadModeHistory();
  const next = withModes(history, on, now);
  if (next === history) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch (err) {
    console.warn("[outbrief] remember modes", err);
  }
}
