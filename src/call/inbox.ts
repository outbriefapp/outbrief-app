import type { EventStatus, HandledBy, RelayedEvent } from "../protocol.ts";

/**
 * Calls the Android call service heard of while the page was paused (OUTB-63,
 * `CallInbox.kt`). A call another device answered meanwhile is gone from the server once the page
 * is back (its ciphertext erased, its status pushed live only), so the service keeps the call and
 * the status it heard for the page's history: "已在 <device> 接听".
 */
export interface InboxEntry {
  id: string;
  /** The call as the stream relayed it, still sealed. */
  event?: RelayedEvent;
  /** What another device last reported about it. */
  status?: { status: EventStatus; handledBy: HandledBy };
}

/** Handled on another device, which one and how unknown (e.g. its status came while offline). */
export const SOMEWHERE_ELSE: HandledBy = { id: "", name: "" };

/** What this device already knows of a call. */
export interface InboxContext {
  /** Still waiting for this device: the stream replays it, it is not settled here. */
  pending: ReadonlySet<string>;
  deviceId: string;
  /** Opened by the page and not ended by it. */
  opened: (id: string) => boolean;
  answeredHere: (id: string) => boolean;
  /** In this device's history: `mine` ended here, `elsewhere` saved as handled on another one. */
  recorded: (id: string) => "mine" | "elsewhere" | null;
}

/**
 * What the page does with an entry: `handOff` a call it opened or already saved as handled
 * elsewhere (the history then says on which device), or `open` one it never saw and save it so.
 */
export type InboxStep =
  | { kind: "handOff"; id: string; status: EventStatus; handledBy: HandledBy }
  | { kind: "open"; event: RelayedEvent; status: EventStatus; handledBy: HandledBy };

export function settleInbox(entries: InboxEntry[], ctx: InboxContext): InboxStep[] {
  const steps: InboxStep[] = [];
  for (const { id, event, status } of entries) {
    if (ctx.pending.has(id)) continue;
    const recorded = ctx.recorded(id);
    const mine =
      status?.handledBy.id === ctx.deviceId || ctx.answeredHere(id) || recorded === "mine";
    if (mine) continue;
    if (ctx.opened(id) || recorded === "elsewhere") {
      // Without a status the reconcile after it ends an opened call as handled somewhere else.
      if (status) steps.push({ kind: "handOff", id, ...status });
      continue;
    }
    if (!event?.sealed) continue;
    steps.push({
      kind: "open",
      event,
      status: status?.status ?? "received",
      handledBy: status?.handledBy ?? SOMEWHERE_ELSE,
    });
  }
  return steps;
}
