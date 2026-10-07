import { describe, expect, it } from "vitest";
import {
  type CallAction,
  callReducer,
  initialCallState,
  missedCalls,
  reportsToPrepare,
} from "./callQueue.ts";
import type { AgentEvent } from "./protocol.ts";

function ev(seq: number, issuePriority?: string): AgentEvent {
  const at = "2026-09-25T00:00:00.000Z";
  const event: AgentEvent = {
    id: `e${seq}`,
    seq,
    source: "codex",
    content: `r${seq}`,
    status: "received",
    occurredAt: at,
    receivedAt: at,
    brief: null,
  };
  if (!issuePriority) return event;
  return {
    ...event,
    source: "multica",
    multica: {
      workspaceId: "ws",
      issueId: `i${seq}`,
      issueIdentifier: `YOUT-${seq}`,
      issueTitle: "t",
      issuePriority,
      agentId: "a",
      agentName: "Mika",
      reportCommentId: "c",
      taskId: "task",
      reply: null,
    },
  };
}

const run = (...actions: CallAction[]) => actions.reduce(callReducer, initialCallState);
const arrived = (seq: number): CallAction => ({ type: "arrived", event: ev(seq) });
const prepared = (seq: number): CallAction => ({ type: "prepared", id: `e${seq}` });
const failed = (seq: number): CallAction => ({
  type: "prepareFailed",
  id: `e${seq}`,
  message: "语音服务暂不可用",
});

describe("callReducer", () => {
  it("does not ring a report until its speech is prepared", () => {
    const s = run(arrived(1));
    expect(s.current).toEqual({ event: ev(1), phase: "preparing" });
    expect(callReducer(s, { type: "accept" })).toBe(s);
    expect(callReducer(s, prepared(1)).current).toEqual({ event: ev(1), phase: "ringing" });
  });

  it("rings the first report and queues reports that arrive during a call", () => {
    const s = run(arrived(1), prepared(1), { type: "accept" }, arrived(2), arrived(3));
    expect(s.current).toEqual({ event: ev(1), phase: "active" });
    expect(s.waiting.map((e) => e.id)).toEqual(["e2", "e3"]);
  });

  it("rings the next queued report after hang-up or decline, in arrival order", () => {
    const s1 = run(
      arrived(1),
      arrived(2),
      arrived(3),
      prepared(3),
      prepared(1),
      prepared(2),
      { type: "accept" },
      { type: "hangUp" },
    );
    expect(s1.current).toEqual({ event: ev(2), phase: "ringing" });
    const s2 = callReducer(s1, { type: "decline" });
    expect(s2.current).toEqual({ event: ev(3), phase: "ringing" });
    expect(s2.waiting).toEqual([]);
    const s3 = callReducer(s2, { type: "decline" });
    expect(s3.current).toBeNull();
    expect(s3.prepared.size).toBe(0);
  });

  it("keeps the next report preparing after a call ends until its speech is ready", () => {
    const s = run(arrived(1), prepared(1), arrived(2), { type: "decline" });
    expect(s.current).toEqual({ event: ev(2), phase: "preparing" });
    expect(callReducer(s, prepared(2)).current).toEqual({ event: ev(2), phase: "ringing" });
  });

  it("moves a report whose speech failed out of the queue without ringing it", () => {
    const s = run(arrived(1), arrived(2), prepared(2), failed(1));
    expect(s.current).toEqual({ event: ev(2), phase: "ringing" });
    expect(s.failed).toEqual([{ event: ev(1), message: "语音服务暂不可用" }]);

    const queued = run(arrived(1), arrived(2), failed(2));
    expect(queued.current).toEqual({ event: ev(1), phase: "preparing" });
    expect(queued.waiting).toEqual([]);
    expect(queued.failed.map((f) => f.event.id)).toEqual(["e2"]);
  });

  it("retries a failed report through the queue, or drops it", () => {
    const s = run(arrived(1), failed(1), { type: "retryPrepare", id: "e1" });
    expect(s.failed).toEqual([]);
    expect(s.current).toEqual({ event: ev(1), phase: "preparing" });
    expect(reportsToPrepare(s)).toEqual([ev(1)]);

    const dropped = run(arrived(1), failed(1), { type: "dropFailed", id: "e1" });
    expect(dropped.failed).toEqual([]);
    expect(dropped.current).toBeNull();
  });

  it("lists the reports still to prepare in ringing order", () => {
    const s = run(arrived(1), arrived(2), arrived(3), prepared(2));
    expect(reportsToPrepare(s).map((e) => e.id)).toEqual(["e1", "e3"]);
    expect(reportsToPrepare(callReducer(s, prepared(1))).map((e) => e.id)).toEqual(["e3"]);
  });

  it("ignores replayed events after a stream reconnect, even once their call ended", () => {
    const s = run(arrived(1), prepared(1), { type: "decline" }, arrived(1));
    expect(s.current).toBeNull();
    expect(s.waiting).toEqual([]);
  });

  it("only accepts a ringing call and only hangs up an active one", () => {
    const ringing = run(arrived(1), prepared(1));
    expect(callReducer(ringing, { type: "hangUp" })).toBe(ringing);
    const active = callReducer(ringing, { type: "accept" });
    expect(callReducer(active, { type: "decline" })).toBe(active);
    expect(callReducer(active, { type: "accept" })).toBe(active);
    expect(callReducer(initialCallState, { type: "accept" })).toBe(initialCallState);
  });
});

describe("callReducer outside the ringing time", () => {
  const quiet: CallAction = { type: "ringAllowedChanged", allowed: false };
  const loud: CallAction = { type: "ringAllowedChanged", allowed: true };
  const ids = (events: AgentEvent[]) => events.map((e) => e.id);

  it("keeps reports arriving in the quiet time as missed calls, even once ringing is allowed", () => {
    const s = run(quiet, arrived(1), prepared(1), arrived(2), prepared(2));
    expect(s.current).toBeNull();
    expect(ids(s.missed)).toEqual(["e1", "e2"]);
    expect(callReducer(s, { type: "accept" })).toBe(s);
    const later = callReducer(s, loud);
    expect(later.current).toBeNull();
    expect(ids(missedCalls(later))).toEqual(["e1", "e2"]);
    // A report arriving in the ringing time rings; the missed ones stay missed after it.
    const rung = run(quiet, arrived(1), prepared(1), loud, arrived(2), prepared(2));
    expect(rung.current).toEqual({ event: ev(2), phase: "ringing" });
    expect(ids(callReducer(rung, { type: "decline" }).missed)).toEqual(["e1"]);
    expect(callReducer(rung, { type: "decline" }).current).toBeNull();
  });

  it("keeps a report received in the quiet time as missed though it arrives in the ringing time", () => {
    const s = run({ type: "arrived", event: ev(1), missed: true }, prepared(1));
    expect(s.current).toBeNull();
    expect(ids(s.missed)).toEqual(["e1"]);
  });

  it("stops ringing when the quiet time starts, but keeps an active call", () => {
    const stopped = run(arrived(1), prepared(1), arrived(2), quiet, loud);
    expect(stopped.current).toBeNull();
    expect(ids(stopped.missed)).toEqual(["e1", "e2"]);
    expect(run(arrived(1), prepared(1), { type: "accept" }, quiet).current?.phase).toBe("active");
  });

  it("does not ring the reports queued behind a call once the quiet time started", () => {
    const s = run(
      arrived(1),
      arrived(2),
      prepared(1),
      prepared(2),
      { type: "accept" },
      quiet,
      loud,
      {
        type: "hangUp",
      },
    );
    expect(s.current).toBeNull();
    expect(ids(s.missed)).toEqual(["e2"]);
  });

  it("lists every missed report and answers the one picked, without ringing", () => {
    const s = run(quiet, arrived(1), arrived(2), arrived(3), prepared(1), prepared(2));
    expect(ids(missedCalls(s))).toEqual(["e1", "e2", "e3"]);
    expect(ids(reportsToPrepare(s))).toEqual(["e3"]);
    const answered = callReducer(s, { type: "answer", id: "e2" });
    expect(answered.current).toEqual({ event: ev(2), phase: "active" });
    expect(ids(missedCalls(answered))).toEqual(["e1", "e3"]);
    expect(answered.ringAllowed).toBe(false);
    // Speech not ready yet: it cannot be answered.
    expect(callReducer(s, { type: "answer", id: "e3" })).toBe(s);
    // After the call the rest stay missed, in the ringing time too.
    const after = run(quiet, arrived(1), arrived(2), prepared(1), prepared(2), loud);
    const hungUp = [
      { type: "answer", id: "e2" } as CallAction,
      { type: "hangUp" } as CallAction,
    ].reduce(callReducer, after);
    expect(hungUp.current).toBeNull();
    expect(ids(hungUp.missed)).toEqual(["e1"]);
  });

  it("answers a missed call before the report preparing to ring, which rings after it", () => {
    const s = run(quiet, arrived(1), prepared(1), loud, arrived(2));
    expect(s.current).toEqual({ event: ev(2), phase: "preparing" });
    const answered = callReducer(s, { type: "answer", id: "e1" });
    expect(answered.current).toEqual({ event: ev(1), phase: "active" });
    expect(ids(answered.waiting)).toEqual(["e2"]);
    const next = callReducer(callReducer(answered, prepared(2)), { type: "hangUp" });
    expect(next.current).toEqual({ event: ev(2), phase: "ringing" });
  });

  it("acknowledges the missed calls picked, leaving the rest", () => {
    const s = run(quiet, arrived(1), arrived(2), arrived(3), prepared(1), loud, arrived(4));
    const acked = callReducer(s, { type: "acknowledge", ids: ["e1", "e2", "e4"] });
    expect(ids(missedCalls(acked))).toEqual(["e3"]);
    expect(acked.current).toBeNull();
    expect(acked.prepared.has("e1")).toBe(false);
    expect(callReducer(acked, prepared(4))).toBe(acked);
    expect(callReducer(acked, { type: "acknowledge", ids: ["e1"] })).toBe(acked);
  });

  it("does not answer a missed call over a call on screen", () => {
    const s = run(arrived(1), prepared(1), arrived(2), prepared(2));
    expect(s.current?.phase).toBe("ringing");
    expect(ids(missedCalls(s))).toEqual(["e2"]);
    expect(callReducer(s, { type: "answer", id: "e2" })).toBe(s);
  });
});

describe("callReducer ringing order", () => {
  const arrivedAs = (seq: number, priority: string): CallAction => ({
    type: "arrived",
    event: ev(seq, priority),
  });

  it("rings the most urgent waiting issue next", () => {
    const s = run(
      arrived(1),
      prepared(1),
      { type: "accept" },
      arrivedAs(2, "low"),
      arrivedAs(3, "urgent"),
      arrivedAs(4, "high"),
    );
    expect(s.waiting.map((e) => e.id)).toEqual(["e3", "e4", "e2"]);
    expect(run(arrivedAs(2, "low"), arrivedAs(3, "urgent")).current?.event.id).toBe("e3");
  });

  it("lists missed calls in ringing order", () => {
    const quiet: CallAction = { type: "ringAllowedChanged", allowed: false };
    const s = run(quiet, arrivedAs(1, "low"), prepared(1), arrivedAs(2, "high"), prepared(2));
    expect(s.current).toBeNull();
    expect(missedCalls(s).map((e) => e.id)).toEqual(["e2", "e1"]);
  });
});

describe("calls another device answered or ended (OUTB-57)", () => {
  const elsewhere = (...seqs: number[]): CallAction => ({
    type: "endedElsewhere",
    ids: seqs.map((seq) => `e${seq}`),
  });

  it("stops ringing and lets the next call ring", () => {
    const s = run(arrived(1), prepared(1), arrived(2), prepared(2), elsewhere(1));
    expect(s.current).toEqual({ event: ev(2), phase: "ringing" });
    expect(s.prepared.has("e1")).toBe(false);
  });

  it("ends the call on screen when this device lost the race to answer it", () => {
    const s = run(arrived(1), prepared(1), { type: "accept" }, elsewhere(1));
    expect(s.current).toBeNull();
  });

  it("drops waiting, missed and failed calls, and never rings them when they arrive later", () => {
    const quiet = run({ type: "ringAllowedChanged", allowed: false }, arrived(1));
    expect(missedCalls(callReducer(quiet, elsewhere(1)))).toEqual([]);

    const waiting = run(arrived(1), prepared(1), { type: "accept" }, arrived(2), elsewhere(2));
    expect(waiting.waiting).toEqual([]);
    expect(waiting.current?.event.id).toBe("e1");

    const broken = run(arrived(1), failed(1), elsewhere(1));
    expect(broken.failed).toEqual([]);

    const early = run(elsewhere(3), arrived(3));
    expect(early.current).toBeNull();
    expect(missedCalls(early)).toEqual([]);
  });

  it("ignores calls this device no longer holds", () => {
    const s = run(arrived(1), prepared(1), { type: "decline" });
    expect(callReducer(s, elsewhere(1))).toBe(s);
  });

  it("after a reconnect drops the calls that ended while offline, but not newer ones", () => {
    const s = run(
      arrived(1),
      prepared(1),
      { type: "accept" },
      arrived(2),
      arrived(3),
      arrived(4),
      arrived(5),
    );
    const after = callReducer(s, { type: "reconciled", pending: new Set(["e3"]), upToSeq: 4 });
    // e1 is on screen, e5 arrived after the pending calls were listed.
    expect(after.current?.event.id).toBe("e1");
    expect(after.waiting.map((e) => e.id).sort()).toEqual(["e3", "e5"]);
    expect(
      callReducer(after, { type: "reconciled", pending: new Set(["e3", "e5"]), upToSeq: 5 }),
    ).toBe(after);
  });
});
