import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arrivalOf, isLate, markAnswered, RING_WINDOW_MS, wasAnswered } from "./answered.ts";

beforeEach(() => {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => items.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("calls answered on this device", () => {
  it("are remembered across reloads", () => {
    expect(wasAnswered("e1")).toBe(false);
    markAnswered("e1");
    markAnswered("e1");
    expect(wasAnswered("e1")).toBe(true);
    expect(JSON.parse(localStorage.getItem("outbrief.answered") ?? "[]")).toEqual(["e1"]);
  });

  it("keep only the latest 200", () => {
    for (let i = 0; i < 205; i++) markAnswered(`e${i}`);
    expect(wasAnswered("e4")).toBe(false);
    expect(wasAnswered("e5")).toBe(true);
    expect(wasAnswered("e204")).toBe(true);
  });

  it("survive a broken value", () => {
    localStorage.setItem("outbrief.answered", "{oops");
    expect(wasAnswered("e1")).toBe(false);
    markAnswered("e1");
    expect(wasAnswered("e1")).toBe(true);
  });
});

describe("arrivalOf", () => {
  const fresh = { recorded: null, answeredHere: false, ringAllowed: true, late: false } as const;

  it("rings a new call", () => {
    expect(arrivalOf(fresh)).toEqual({ kind: "ring" });
  });

  it("never shows again a call that already ended here, and re-reports how it ended", () => {
    expect(arrivalOf({ ...fresh, recorded: "completed", answeredHere: true })).toEqual({
      kind: "ended",
      outcome: "completed",
    });
    expect(arrivalOf({ ...fresh, recorded: "acknowledged" })).toEqual({
      kind: "ended",
      outcome: "acknowledged",
    });
  });

  it("lists a call cut off by a reload as missed instead of ringing it again", () => {
    expect(arrivalOf({ ...fresh, answeredHere: true })).toEqual({ kind: "missed" });
  });

  it("keeps quiet-time calls missed", () => {
    expect(arrivalOf({ ...fresh, ringAllowed: false })).toEqual({ kind: "missed" });
  });

  it("lists a call heard of too late as missed: pending since before an update, or while offline", () => {
    expect(arrivalOf({ ...fresh, late: true })).toEqual({ kind: "missed" });
  });
});

describe("isLate", () => {
  const received = new Date("2026-10-07T07:00:00Z");
  const later = (ms: number) => new Date(received.getTime() + ms);

  it("lets a call ring within the window, also when the phone's clock is a little behind", () => {
    expect(isLate(received, later(0))).toBe(false);
    expect(isLate(received, later(RING_WINDOW_MS))).toBe(false);
    expect(isLate(received, later(-30_000))).toBe(false);
  });

  it("is late past the window, e.g. hours later after an update", () => {
    expect(isLate(received, later(RING_WINDOW_MS + 1))).toBe(true);
    expect(isLate(received, later(15 * 60 * 60_000))).toBe(true);
  });
});
