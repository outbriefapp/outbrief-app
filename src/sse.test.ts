import { describe, expect, it } from "vitest";
import { SseParser } from "./sse.ts";

describe("SseParser", () => {
  it("reassembles frames split across chunks and joins multi-line data", () => {
    const p = new SseParser();
    expect(p.push('event: agent-event\nid: 7\ndata: {"a"')).toEqual([]);
    expect(p.push(":1}\n\nevent: agent-event\r\ndata: line1\r\ndata: line2\r\n\r\n")).toEqual([
      { event: "agent-event", id: "7", data: '{"a":1}' },
      { event: "agent-event", data: "line1\nline2" },
    ]);
  });

  it("drops comments and data-less frames, defaults the event name", () => {
    const p = new SseParser();
    expect(p.push(": keepalive\n\nevent: ping\n\ndata: x\n\n")).toEqual([
      { event: "message", data: "x" },
    ]);
  });
});
