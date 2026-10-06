import { describe, expect, it } from "vitest";
import type { RelayedEvent, SealedReport } from "../protocol.ts";
import {
  type E2eKey,
  importKey,
  openJson,
  REPORT_AAD,
  replyAad,
  replyErrorAad,
  sealJson,
  sealText,
} from "./crypto.ts";
import { applyUpdate, openEvent, openUpdate, sealReply, UnreadableCallError } from "./events.ts";

const REPORT: SealedReport = {
  title: "YOUT-7 修复登录跳转",
  content: "改好了",
  sessionId: "s1",
  brief: { status: "failed", brief: null, llmChannel: null, error: "no LLM", generatedAt: "t" },
  multica: {
    workspaceId: "ws",
    issueId: "i1",
    issueIdentifier: "YOUT-7",
    issueTitle: "修复登录跳转",
    agentId: "a1",
    agentName: "Mika",
    reportCommentId: "c1",
  },
};

function newKey(): Promise<E2eKey> {
  return importKey(crypto.getRandomValues(new Uint8Array(32)));
}

async function relayed(key: E2eKey, extra: Partial<RelayedEvent> = {}): Promise<RelayedEvent> {
  return {
    id: "e1",
    seq: 3,
    source: "multica",
    status: "received",
    occurredAt: "2026-09-28T01:00:00.000Z",
    receivedAt: "2026-09-28T01:00:01.000Z",
    sealed: await sealJson(key, REPORT_AAD, REPORT),
    multica: { taskId: "t1", reply: null },
    machine: { id: "m1", name: "mac", online: true },
    ...extra,
  };
}

describe("opening relayed calls", () => {
  it("opens a sealed call into what the app shows and speaks", async () => {
    const key = await newKey();
    const event = await openEvent(key, await relayed(key));
    expect(event).toMatchObject({
      id: "e1",
      seq: 3,
      title: REPORT.title,
      content: "改好了",
      sessionId: "s1",
      brief: REPORT.brief,
      multica: { ...REPORT.multica, taskId: "t1", reply: null },
      machine: { name: "mac" },
    });
  });

  it("refuses calls sealed with another key, and erased ones", async () => {
    const key = await newKey();
    const other = await newKey();
    await expect(openEvent(other, await relayed(key))).rejects.toThrow(/密钥不一致/);
    await expect(openEvent(key, await relayed(key, { sealed: null }))).rejects.toBeInstanceOf(
      UnreadableCallError,
    );
    await expect(openEvent(key, await relayed(key, { sealed: "改好了" }))).rejects.toThrow(
      /不是加密数据/,
    );
  });

  it("seals the reply for the daemon with where it goes, bound to the event", async () => {
    const key = await newKey();
    const event = await openEvent(key, await relayed(key));
    const sealed = await sealReply(key, event, "删掉旧接口");
    expect(sealed).not.toContain("删掉旧接口");
    expect(await openJson(key, replyAad("e1"), sealed)).toEqual({
      content: "删掉旧接口",
      sessionId: "s1",
      multica: { workspaceId: "ws", issueId: "i1", reportCommentId: "c1" },
    });
    await expect(openJson(key, replyAad("e2"), sealed)).rejects.toThrow();
  });

  it("opens a sealed failure reason and passes plain ones through", async () => {
    const key = await newKey();
    const delivery = {
      id: "r1",
      status: "failed" as const,
      error: await sealText(key, replyErrorAad("r1"), "HTTP 403 forbidden"),
      createdAt: "c",
      settledAt: "s",
      expiresAt: "x",
    };
    const update = await openUpdate(key, await relayed(key, { delivery }));
    expect(update.delivery).toMatchObject({ status: "failed", error: "HTTP 403 forbidden" });
    const plain = await openUpdate(
      key,
      await relayed(key, { delivery: { ...delivery, error: "电脑一直离线，回复已过期" } }),
    );
    expect(plain.delivery?.error).toBe("电脑一直离线，回复已过期");

    const event = await openEvent(key, await relayed(key));
    const sent = applyUpdate(event, {
      id: "e1",
      delivery: { ...delivery, content: "继续", error: null },
    });
    const settled = applyUpdate(sent, update);
    expect(settled.delivery).toMatchObject({ content: "继续", error: "HTTP 403 forbidden" });
    expect(settled.content).toBe("改好了");
  });
});
