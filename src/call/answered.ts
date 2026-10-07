import type { CallOutcome, EventStatus } from "../protocol.ts";

const KEY = "outbrief.answered";
/** Ids kept; far more calls than can be pending at once. */
const MAX_IDS = 200;

/**
 * Calls answered on this device, kept across reloads (YOUT-226). The server keeps a call pending
 * until it ends, so after the app restarts or its page reloads mid-call (a new build, a dev
 * reload) the call arrives again: it must not ring a second time.
 */
export function markAnswered(eventId: string): void {
  const ids = loadIds().filter((id) => id !== eventId);
  ids.push(eventId);
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-MAX_IDS)));
  } catch (err) {
    console.warn("[outbrief] remember answered call", err);
  }
}

export function wasAnswered(eventId: string): boolean {
  return loadIds().includes(eventId);
}

function loadIds(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/**
 * How long after the server received a call it may still ring here. A call this device hears of
 * later was never rung in time — the app was closed, asleep or offline, or it is a call still pending
 * from before an update or restart — so it is missed, like a call to a phone that was off. Two
 * minutes leave room for the webview to resume when a call notification is opened (OUTB-60) and
 * for a phone clock that is a little off; the Android service uses the same window.
 */
export const RING_WINDOW_MS = 2 * 60_000;

/** Whether a call received at `receivedAt` (server time) is too old to ring at `now`. */
export function isLate(receivedAt: Date, now: Date): boolean {
  return now.getTime() - receivedAt.getTime() > RING_WINDOW_MS;
}

/**
 * What a call the server delivers should do on this device:
 * - `ended`: it already ended here (it is in the history as `outcome`) but the server did not hear
 *   so — its status report failed, e.g. while the server restarted. It is not shown again; the
 *   outcome is reported once more.
 * - `missed`: answered here before and cut off (restart / reload), received in the quiet time, or
 *   heard of too late to ring (`isLate`): listed under 未接来电, never rings by itself.
 * - `ring`: a new call.
 */
export type Arrival =
  | { kind: "ended"; outcome: CallOutcome }
  | { kind: "missed" }
  | { kind: "ring" };

export function arrivalOf(input: {
  /** Status of this device's history record of the call, if it has one. */
  recorded: EventStatus | null;
  answeredHere: boolean;
  ringAllowed: boolean;
  /** This device hears of the call only past `RING_WINDOW_MS`. */
  late: boolean;
}): Arrival {
  if (input.recorded && input.recorded !== "received") {
    return { kind: "ended", outcome: input.recorded };
  }
  return input.answeredHere || !input.ringAllowed || input.late
    ? { kind: "missed" }
    : { kind: "ring" };
}
