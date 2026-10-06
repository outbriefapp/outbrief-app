import { describe, expect, it } from "vitest";
import type { CallRecord } from "./call/records.ts";
import {
  ALL_PROJECTS,
  byProject,
  callProject,
  callsIn,
  issueRefs,
  projectTabs,
  sortCalls,
  withIssue,
} from "./callList.ts";
import type { AgentEvent, MulticaReport } from "./protocol.ts";

function record(id: string, event: Partial<AgentEvent> = {}): CallRecord {
  return {
    eventId: id,
    savedAt: "2026-09-28T00:00:00.000Z",
    event: {
      id,
      seq: 1,
      source: "codex",
      content: "r",
      status: "completed",
      occurredAt: "2026-09-28T00:00:00.000Z",
      receivedAt: "2026-09-28T00:00:00.000Z",
      brief: null,
      ...event,
    },
    transcript: [],
    decisions: [],
    reply: null,
  };
}

function multica(id: string, m: Partial<MulticaReport>, receivedAt = "2026-09-28T00:00:00.000Z") {
  return record(id, {
    source: "multica",
    receivedAt,
    multica: {
      workspaceId: "ws-1",
      issueId: `issue-${id}`,
      issueIdentifier: "YOUT-1",
      issueTitle: "t",
      agentId: "a",
      agentName: "Mika",
      reportCommentId: "c",
      taskId: "task",
      reply: null,
      ...m,
    },
  });
}

const OUTBRIEF = { projectId: "p1", projectTitle: "outbrief" };
const DUBBING = { projectId: "p2", projectTitle: "YouTubeDubbing" };

describe("sortCalls", () => {
  it("puts the most urgent issue first, then the most recently updated", () => {
    const sorted = sortCalls([
      multica("low", { issuePriority: "low", issueUpdatedAt: "2026-09-28T09:00:00Z" }),
      multica("none-new", { issuePriority: "none", issueUpdatedAt: "2026-09-28T08:00:00Z" }),
      multica("high-old", { issuePriority: "high", issueUpdatedAt: "2026-09-28T01:00:00Z" }),
      multica("urgent", { issuePriority: "urgent", issueUpdatedAt: "2026-09-27T00:00:00Z" }),
      multica("high-new", { issuePriority: "high", issueUpdatedAt: "2026-09-28T02:00:00Z" }),
      // A local agent has no priority: it ranks with "none", by when it arrived.
      record("local", { receivedAt: "2026-09-28T07:00:00Z" }),
      multica("odd", { issuePriority: "someday", issueUpdatedAt: "2026-09-28T06:00:00Z" }),
    ]);
    expect(sorted.map((r) => r.eventId)).toEqual([
      "urgent",
      "high-new",
      "high-old",
      "low",
      "none-new",
      "local",
      "odd",
    ]);
  });

  it("uses when the call arrived for reports without an issue update time", () => {
    const sorted = sortCalls([
      multica("old", {}, "2026-09-27T00:00:00Z"),
      multica("new", {}, "2026-09-28T00:00:00Z"),
    ]);
    expect(sorted.map((r) => r.eventId)).toEqual(["new", "old"]);
  });
});

describe("project tabs", () => {
  it("only takes a Multica issue's project for a project", () => {
    expect(callProject(multica("a", OUTBRIEF).event)).toEqual({
      key: "multica:p1",
      label: "outbrief",
    });
    expect(callProject(multica("b", { projectId: null, projectTitle: null }).event)).toBeNull();
    // A local report's folder or title is not a project.
    expect(callProject(record("c", { title: "x", cwd: "/tmp/yout-200/" }).event)).toBeNull();
    expect(callProject(record("d", { title: "YOUT-198 验收" }).event)).toBeNull();
  });

  it("lists one tab per project in list order and filters by it", () => {
    const sorted = sortCalls([
      multica("a", { ...DUBBING, issuePriority: "low" }),
      multica("b", { ...OUTBRIEF, issuePriority: "urgent" }),
      multica("c", { ...DUBBING, issuePriority: "high" }),
    ]);
    const events = sorted.map((r) => r.event);
    const missed = [
      multica("m", { ...DUBBING }).event,
      record("local", { cwd: "/w/yout-200" }).event,
    ];
    expect(projectTabs(missed, events)).toEqual([
      { key: "multica:p2", label: "YouTubeDubbing", missed: 1, past: 2 },
      { key: "multica:p1", label: "outbrief", missed: 0, past: 1 },
    ]);
    const eventOf = (r: CallRecord) => r.event;
    expect(callsIn(sorted, "multica:p2", eventOf).map((r) => r.eventId)).toEqual(["c", "a"]);
    expect(callsIn(sorted, ALL_PROJECTS, eventOf)).toBe(sorted);
  });

  it("groups a sorted list by project, keeping the order inside each group", () => {
    const sorted = sortCalls([
      multica("a", { ...DUBBING, issuePriority: "low" }),
      multica("b", { ...OUTBRIEF, issuePriority: "urgent" }),
      multica("c", { ...DUBBING, issuePriority: "high" }),
      record("local", { cwd: "/w/yout-200" }),
    ]);
    expect(
      byProject(sorted, (r) => r.event).map((g) => [
        g.project.label,
        g.items.map((r) => r.eventId),
      ]),
    ).toEqual([
      ["outbrief", ["b"]],
      ["YouTubeDubbing", ["c", "a"]],
      ["其他", ["local"]],
    ]);
  });
});

describe("refreshing issues", () => {
  it("asks once per issue and only for Multica calls", () => {
    expect(
      issueRefs([multica("a", {}), multica("b", { issueId: "issue-a" }), record("local")]),
    ).toEqual([{ workspaceId: "ws-1", issueId: "issue-a" }]);
  });

  it("takes the issue as Multica has it now", () => {
    const { event } = multica("a", { ...OUTBRIEF, issuePriority: "none" });
    const updated = withIssue(event, [
      {
        workspaceId: "ws-1",
        issueId: "issue-a",
        issueIdentifier: "YOUT-1",
        issueTitle: "改了标题",
        ...DUBBING,
        issuePriority: "urgent",
        issueUpdatedAt: "2026-09-29T00:00:00Z",
      },
    ]);
    expect(updated.multica).toMatchObject({
      issueTitle: "改了标题",
      projectTitle: "YouTubeDubbing",
      issuePriority: "urgent",
      issueUpdatedAt: "2026-09-29T00:00:00Z",
      reportCommentId: "c",
    });
    expect(withIssue(event, [])).toBe(event);
  });
});
