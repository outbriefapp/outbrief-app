import { describe, expect, it } from "vitest";
import { callStatusLabel, formatDateTime, projectName } from "./format.ts";
import type { AgentEvent } from "./protocol.ts";

describe("formatDateTime", () => {
  it("writes the local date and time down to the second", () => {
    const at = new Date(2026, 8, 3, 7, 5, 9);
    expect(formatDateTime(at.toISOString())).toBe("2026-09-03 07:05:09");
  });
});

describe("projectName", () => {
  const call = (multica: Partial<NonNullable<AgentEvent["multica"]>> | undefined) =>
    ({ multica }) as AgentEvent;

  it("names the workspace before the project only when the daemon says which", () => {
    expect(projectName(call({ projectTitle: "outbrief" }))).toBe("outbrief");
    expect(projectName(call({ workspaceName: "side", projectTitle: "outbrief" }))).toBe(
      "side · outbrief",
    );
    expect(projectName(call({ workspaceName: "side", projectTitle: null }))).toBe("side");
    expect(projectName(call({ projectTitle: null }))).toBeNull();
    expect(projectName(call(undefined))).toBeNull();
  });
});

describe("callStatusLabel", () => {
  const call = (status: AgentEvent["status"], handledBy?: AgentEvent["handledBy"]) =>
    ({ status, handledBy }) as AgentEvent;

  it("says where another device answered or ended the call (OUTB-57)", () => {
    expect(callStatusLabel(call("completed"))).toBe("已完成");
    expect(callStatusLabel(call("completed", { id: "d", name: "iPhone" }))).toBe(
      "已在 iPhone 接听",
    );
    expect(callStatusLabel(call("dismissed", { id: "d", name: "Mac" }))).toBe("已在 Mac 拒绝");
    expect(callStatusLabel(call("received", { id: "", name: "" }))).toBe("已在其他设备处理");
  });
});
