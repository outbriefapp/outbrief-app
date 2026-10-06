import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectionProblem,
  dispatchTag,
  failureMessage,
  initialPick,
  loadLastPick,
  refusalMessage,
  saveLastPick,
} from "./dispatch.ts";
import { setLocale } from "./i18n/index.ts";
import type { Dispatch, DispatchOptions } from "./protocol.ts";
import { ServerError } from "./serverClient.ts";

const OPTIONS: DispatchOptions = {
  projects: [
    { id: "p1", title: "outbrief" },
    { id: "p2", title: "lumivo" },
  ],
  agents: [
    { id: "a1", name: "资深架构师", description: "", online: false },
    { id: "a2", name: "页面工程师", description: "", online: true },
    { id: "a3", name: "Mika", description: "", online: true },
  ],
};

const LOCAL = { kind: "local", localKey: "k" } as const;

beforeEach(() => {
  setLocale("zh");
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => items.set(k, v),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("the project and agent the page starts with", () => {
  it("are the last dispatch's while they still exist", () => {
    expect(loadLastPick()).toBeNull();
    saveLastPick({ projectId: "p2", agentId: "a3" });
    const pick = initialPick(OPTIONS, loadLastPick());
    expect([pick.project?.id, pick.agent?.id]).toEqual(["p2", "a3"]);
  });

  it("keep an offline agent that was picked last time: the page says it cannot run now", () => {
    const pick = initialPick(OPTIONS, { projectId: "p1", agentId: "a1" });
    expect(pick.agent?.id).toBe("a1");
  });

  it("start from the first project and the first online agent the first time", () => {
    const pick = initialPick(OPTIONS, null);
    expect([pick.project?.id, pick.agent?.id]).toEqual(["p1", "a2"]);
    const gone = initialPick(OPTIONS, { projectId: "deleted", agentId: "deleted" });
    expect([gone.project?.id, gone.agent?.id]).toEqual(["p1", "a2"]);
    expect(initialPick({ projects: [], agents: [] }, null)).toEqual({ project: null, agent: null });
  });
});

describe("why dispatching does not work now", () => {
  it("names an offline computer, a stopped local daemon and a missing Multica token", () => {
    const offline = new ServerError("电脑「mac」现在不在线", null, { code: "machine_offline" });
    expect(connectionProblem(offline, LOCAL)).toBe("电脑「mac」现在不在线。电脑上线后自动恢复");
    const down = new ServerError("无法连接服务器：TypeError", null);
    expect(connectionProblem(down, LOCAL)).toMatch(/本机的 outbrief-daemon 没有运行/);
    const unset = new ServerError("x", 422, { code: "multica_not_configured" });
    expect(connectionProblem(unset, LOCAL)).toMatch(/还没设置 Multica/);
  });

  it("passes on Multica's reason when it refuses the agent", () => {
    const refused = new ServerError("x", 422, {
      code: "agent_unavailable",
      detail: "runtime is offline",
    });
    expect(refusalMessage(refused, "Mika")).toBe("「Mika」现在不能接单：runtime is offline");
    expect(refusalMessage(new ServerError("HTTP 502", 502), "Mika")).toBe(
      "Multica 没有接单：HTTP 502",
    );
  });
});

describe("a dispatch in 我的派单", () => {
  const dispatch = (extra: Partial<Dispatch>): Dispatch => ({
    id: "t1",
    workspaceId: "ws",
    projectId: "p1",
    projectTitle: "outbrief",
    agentId: "a2",
    agentName: "页面工程师",
    prompt: "加个按钮",
    createdAt: "2026-09-30T10:00:00Z",
    state: "creating",
    issue: null,
    error: null,
    ...extra,
  });

  it("is tagged with the issue's status once it exists", () => {
    expect(dispatchTag(dispatch({}))).toBe("创建中");
    const issue = { id: "i", identifier: "YOUT-1", title: "t", status: "in_review", priority: "" };
    expect(dispatchTag(dispatch({ state: "created", issue }))).toBe("待验收");
    expect(dispatchTag(dispatch({ state: "created", issue: { ...issue, status: "qa" } }))).toBe(
      "qa",
    );
  });

  it("says why no issue was created", () => {
    expect(failureMessage("no_issue_created")).toBe("Agent 跑完了，但没有创建 issue");
    expect(failureMessage("duplicate issue exists")).toBe("duplicate issue exists");
    expect(failureMessage(null)).toBe("Agent 运行失败");
  });
});
