import { describe, expect, it } from "vitest";
import { formatDateTime } from "./format.ts";

describe("formatDateTime", () => {
  it("writes the local date and time down to the second", () => {
    const at = new Date(2026, 8, 3, 7, 5, 9);
    expect(formatDateTime(at.toISOString())).toBe("2026-09-03 07:05:09");
  });
});
