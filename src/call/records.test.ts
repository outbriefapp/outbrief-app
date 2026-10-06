import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { applyUpdate } from "../e2e/events.ts";
import type { AgentEvent } from "../protocol.ts";
import {
  endedCall,
  listCallRecords,
  loadCallRecord,
  MAX_RECORDS,
  saveCallRecord,
  updateCallRecord,
} from "./records.ts";

/** In-memory `Storage`; `limit` caps the total characters like a browser quota. */
class MemoryStorage {
  readonly items = new Map<string, string>();
  limit = Number.POSITIVE_INFINITY;
  get length(): number {
    return this.items.size;
  }
  key(i: number): string | null {
    return [...this.items.keys()][i] ?? null;
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    let used = value.length;
    for (const [k, v] of this.items) if (k !== key) used += v.length;
    if (used > this.limit) throw new DOMException("full", "QuotaExceededError");
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

let storage: MemoryStorage;
beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
});
afterEach(() => vi.unstubAllGlobals());

function event(id: string, receivedAt: string, extra: Partial<AgentEvent> = {}): AgentEvent {
  return {
    id,
    seq: 1,
    source: "claude-code",
    content: `report ${id}`,
    status: "received",
    occurredAt: receivedAt,
    receivedAt,
    brief: {
      status: "failed",
      brief: null,
      llmChannel: null,
      generatedAt: receivedAt,
    },
    ...extra,
  };
}

describe("call records (local history)", () => {
  it("keeps the whole call on the device and lists the newest first", () => {
    saveCallRecord(endedCall(event("a", "2026-09-28T01:00:00.000Z"), "completed"));
    saveCallRecord(
      endedCall(event("b", "2026-09-28T02:00:00.000Z"), "dismissed", { reply: "好的" }),
    );
    // Written before history moved to the device: no event, not listed.
    storage.setItem("outbrief.call.old", JSON.stringify({ eventId: "old", savedAt: "x" }));

    const records = listCallRecords();
    expect(records.map((r) => [r.eventId, r.event.status, r.reply])).toEqual([
      ["b", "dismissed", "好的"],
      ["a", "completed", null],
    ]);
    expect(records[1]?.event.content).toBe("report a");
    expect(loadCallRecord("old")).toBeNull();
  });

  it(`keeps at most ${MAX_RECORDS} records, dropping the oldest saved`, () => {
    for (let i = 0; i <= MAX_RECORDS; i++) {
      const record = endedCall(event(`e${i}`, "2026-09-28T01:00:00.000Z"), "completed");
      saveCallRecord({
        ...record,
        savedAt: new Date(Date.UTC(2026, 8, 28, 0, 0, i)).toISOString(),
      });
    }
    expect(listCallRecords()).toHaveLength(MAX_RECORDS);
    expect(loadCallRecord("e0")).toBeNull();
    expect(loadCallRecord(`e${MAX_RECORDS}`)).not.toBeNull();
  });

  it("makes room by dropping the oldest records when storage is full", () => {
    const first = endedCall(event("a", "2026-09-28T01:00:00.000Z"), "completed");
    saveCallRecord({ ...first, savedAt: "2026-09-28T01:00:00.000Z" });
    storage.limit = JSON.stringify(first).length + 200;
    saveCallRecord(endedCall(event("b", "2026-09-28T02:00:00.000Z"), "completed"));
    expect(listCallRecords().map((r) => r.eventId)).toEqual(["b"]);

    storage.limit = 10;
    expect(() =>
      saveCallRecord(endedCall(event("c", "2026-09-28T03:00:00.000Z"), "completed")),
    ).toThrow(DOMException);
  });

  it("merges delivery updates into the local copy", () => {
    const local = event("a", "2026-09-28T01:00:00.000Z", {
      title: "修登录",
      cwd: "/w",
      machine: { id: "m1", name: "mac", online: false },
      multica: {
        workspaceId: "ws",
        taskId: "t",
        issueId: "i",
        issueIdentifier: "YOUT-1",
        issueTitle: "修登录",
        agentId: "ag",
        agentName: "Mika",
        reportCommentId: "c1",
        reply: null,
      },
      delivery: {
        id: "r1",
        content: "继续",
        status: "queued",
        error: null,
        createdAt: "2026-09-28T01:01:00.000Z",
        settledAt: null,
        expiresAt: "2026-09-29T01:01:00.000Z",
      },
    });
    saveCallRecord(endedCall(local, "completed", { reply: "继续" }));
    // What the server can still say once the call ended: no report, no reply text.
    const update = {
      id: "a",
      machine: { id: "m1", name: "mac", online: true },
      multicaReply: { commentId: "c2", sentAt: "2026-09-28T01:02:00.000Z" },
      delivery: local.delivery && { ...local.delivery, content: "", status: "delivered" as const },
    };

    updateCallRecord("a", (r) => ({ ...r, event: applyUpdate(r.event, update) }));
    const saved = loadCallRecord("a")?.event;
    expect(saved).toMatchObject({
      status: "completed",
      title: "修登录",
      cwd: "/w",
      content: "report a",
      machine: { online: true },
      delivery: { status: "delivered", content: "继续" },
      multica: { issueTitle: "修登录", reply: { commentId: "c2" } },
    });
    expect(saved?.brief).not.toBeNull();

    // No local record of that call (answered on another device): nothing is written.
    updateCallRecord("zzz", (r) => r);
    expect(loadCallRecord("zzz")).toBeNull();
  });
});
