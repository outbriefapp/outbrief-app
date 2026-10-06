import { describe, expect, it } from "vitest";
import { personalizeEvent } from "./addressName.ts";
import type { AgentEvent, Brief } from "./protocol.ts";

const BRIEF: Brief = {
  verdict: { status: "done", headline: "{称呼}，登录页改好了" },
  facts: [{ id: "f1", text: "登录页重构完成", importance: "critical" }],
  segments: [
    {
      id: "s1",
      speech: "{称呼}，登录页重构做完了。",
      card: { title: "结果", bullets: ["重构完成"] },
      coveredFactIds: ["f1"],
    },
  ],
  decisions: [
    {
      id: "d1",
      question: "{称呼}，旧接口要删吗？",
      options: [{ id: "a", label: "删掉" }],
      recommendedOptionId: null,
      reason: null,
    },
  ],
};

function event(brief: Brief | null): AgentEvent {
  return {
    id: "e1",
    seq: 1,
    source: "codex",
    content: "done",
    status: "received",
    occurredAt: "2026-09-28T00:00:00Z",
    receivedAt: "2026-09-28T00:00:00Z",
    brief: {
      status: brief ? "ready" : "failed",
      brief,
      llmChannel: null,
      generatedAt: "2026-09-28T00:00:00Z",
    },
  };
}

describe("personalizeEvent", () => {
  it("fills the user's 称呼 into every text of the brief", () => {
    const out = personalizeEvent(event(BRIEF), "李哥");
    expect(out.brief?.brief?.verdict.headline).toBe("李哥，登录页改好了");
    expect(out.brief?.brief?.segments[0]?.speech).toBe("李哥，登录页重构做完了。");
    expect(out.brief?.brief?.decisions[0]?.question).toBe("李哥，旧接口要删吗？");
  });

  it("keeps names with JSON-special characters intact", () => {
    const out = personalizeEvent(event(BRIEF), 'A"B\\C');
    expect(out.brief?.brief?.segments[0]?.speech).toBe('A"B\\C，登录页重构做完了。');
  });

  it("passes events without a brief or placeholder through unchanged", () => {
    const failed = event(null);
    expect(personalizeEvent(failed, "李哥")).toBe(failed);
    const plain = event({
      ...BRIEF,
      verdict: { status: "done", headline: "好了" },
      segments: [],
      decisions: [],
    });
    expect(personalizeEvent(plain, "李哥")).toBe(plain);
  });
});
