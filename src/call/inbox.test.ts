import { describe, expect, it } from "vitest";
import type { RelayedEvent } from "../protocol.ts";
import { type InboxContext, SOMEWHERE_ELSE, settleInbox } from "./inbox.ts";

const pc = { id: "pc", name: "MacBook" };

function relayed(id: string): RelayedEvent {
  return {
    id,
    seq: 1,
    source: "claude-code",
    status: "received",
    occurredAt: "2026-10-09T06:00:00Z",
    receivedAt: "2026-10-09T06:00:00Z",
    sealed: "sealed",
  } as RelayedEvent;
}

const ctx: InboxContext = {
  pending: new Set(),
  deviceId: "phone",
  opened: () => false,
  answeredHere: () => false,
  recorded: () => null,
};

describe("settleInbox", () => {
  it("saves a call another device answered while the page was paused", () => {
    const event = relayed("e1");
    expect(
      settleInbox([{ id: "e1", event, status: { status: "completed", handledBy: pc } }], ctx),
    ).toEqual([{ kind: "open", event, status: "completed", handledBy: pc }]);
  });

  it("saves an ended call whose status it never heard as handled somewhere else", () => {
    const event = relayed("e1");
    expect(settleInbox([{ id: "e1", event }], ctx)).toEqual([
      { kind: "open", event, status: "received", handledBy: SOMEWHERE_ELSE },
    ]);
  });

  it("leaves calls still waiting for this device to the stream", () => {
    const entry = { id: "e1", event: relayed("e1"), status: { status: "received", handledBy: pc } };
    expect(settleInbox([entry] as never, { ...ctx, pending: new Set(["e1"]) })).toEqual([]);
  });

  it("skips calls this device handled", () => {
    const event = relayed("e1");
    const status = { status: "completed", handledBy: pc } as const;
    expect(
      settleInbox([{ id: "e1", event, status }], { ...ctx, answeredHere: () => true }),
    ).toEqual([]);
    expect(settleInbox([{ id: "e1", event, status }], { ...ctx, recorded: () => "mine" })).toEqual(
      [],
    );
    expect(
      settleInbox(
        [
          {
            id: "e1",
            event,
            status: { status: "completed", handledBy: { id: "phone", name: "" } },
          },
        ],
        ctx,
      ),
    ).toEqual([]);
  });

  it("hands off a call the page opened or saved already, naming the device", () => {
    const status = { status: "completed", handledBy: pc } as const;
    const step = { kind: "handOff", id: "e1", status: "completed", handledBy: pc };
    expect(settleInbox([{ id: "e1", status }], { ...ctx, opened: () => true })).toEqual([step]);
    expect(settleInbox([{ id: "e1", status }], { ...ctx, recorded: () => "elsewhere" })).toEqual([
      step,
    ]);
    expect(
      settleInbox([{ id: "e1", event: relayed("e1") }], { ...ctx, opened: () => true }),
    ).toEqual([]);
  });

  it("cannot save a call it has no ciphertext of", () => {
    expect(
      settleInbox([{ id: "e1", status: { status: "completed", handledBy: pc } }], ctx),
    ).toEqual([]);
  });
});
