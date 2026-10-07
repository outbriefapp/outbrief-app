import { compareCalls } from "./callList.ts";
import { applyUpdate, type EventUpdate } from "./e2e/events.ts";
import type { AgentEvent } from "./protocol.ts";

/** A report whose speech could not be synthesized; it never rang and waits for 重试 / 忽略. */
export interface FailedReport {
  event: AgentEvent;
  message: string;
}

/**
 * One call at a time: a report arriving while another call rings or is active waits. Waiting reports
 * ring in the order of the calls screen (`compareCalls`: most urgent issue first, then the most
 * recently updated); a head that is not on screen yet gives way to a more urgent report.
 * A report only rings once all of its speech is synthesized (`prepared`): until then the head of the
 * queue is `preparing`. A report whose speech fails leaves the queue for `failed` without ringing.
 * Outside the active mode's ringing time (`ringAllowed` false) nothing rings: a report arriving then,
 * and every report still waiting or ringing when the quiet time starts, is `missed`. Missed reports
 * never ring by themselves, not even once ringing is allowed again (YOUT-212): the user answers the
 * ones they want from the calls screen (`answer`), in any order, and acknowledges the rest
 * (`acknowledge`). Every report not on screen is listed there (`missedCalls`, YOUT-210).
 * Every device of the account rings at once: a call another device answered or ended leaves this
 * device's queue wherever it is (`endedElsewhere`), ringing or even on screen when this device lost
 * the race to answer it (OUTB-57).
 */
export interface CallState {
  current: { event: AgentEvent; phase: "preparing" | "ringing" | "active" } | null;
  /** Reports that ring once the call on screen ends, in ringing order. */
  waiting: AgentEvent[];
  /** Reports that do not ring by themselves, in ringing order. */
  missed: AgentEvent[];
  /** Ids whose speech is fully synthesized. */
  prepared: ReadonlySet<string>;
  failed: FailedReport[];
  /** Ids ever seen, so stream replays after reconnect never ring twice. */
  knownIds: ReadonlySet<string>;
  /** Whether the active mode lets calls ring right now. */
  ringAllowed: boolean;
}

export type CallAction =
  /** `missed`: it arrived outside the ringing time (it was received then), so it must not ring. */
  | { type: "arrived"; event: AgentEvent; missed?: boolean }
  | { type: "eventUpdated"; update: EventUpdate }
  | { type: "prepared"; id: string }
  | { type: "prepareFailed"; id: string; message: string }
  | { type: "retryPrepare"; id: string }
  | { type: "dropFailed"; id: string }
  | { type: "ringAllowedChanged"; allowed: boolean }
  | { type: "answer"; id: string }
  | { type: "acknowledge"; ids: string[] }
  /** Another device answered or ended these calls. */
  | { type: "endedElsewhere"; ids: string[] }
  /**
   * After a reconnect: of the calls up to `upToSeq`, only `pending` still wait for this device; the
   * rest ended on another device while this one was offline. The call on screen stays.
   */
  | { type: "reconciled"; pending: ReadonlySet<string>; upToSeq: number }
  | { type: "accept" }
  | { type: "decline" }
  | { type: "hangUp" };

export const initialCallState: CallState = {
  current: null,
  waiting: [],
  missed: [],
  prepared: new Set(),
  failed: [],
  knownIds: new Set(),
  ringAllowed: true,
};

/** Whether the current call is on screen: ringing or answered. */
function onScreen(state: CallState): boolean {
  return state.current?.phase === "ringing" || state.current?.phase === "active";
}

/** Reports that will ring by themselves, the preparing head included. */
function queued(state: CallState): AgentEvent[] {
  return onScreen(state) || !state.current
    ? state.waiting
    : [state.current.event, ...state.waiting];
}

/**
 * Keeps the queue in ringing order. While no call is on screen the first report to ring takes the
 * head, preparing until its speech is ready.
 */
function reorder(state: CallState): CallState {
  const missed = [...state.missed].sort(compareCalls);
  if (onScreen(state)) return { ...state, missed, waiting: [...state.waiting].sort(compareCalls) };
  const [head, ...rest] = [...queued(state)].sort(compareCalls);
  const phase = head && state.prepared.has(head.id) ? "ringing" : "preparing";
  return { ...state, missed, current: head ? { event: head, phase } : null, waiting: rest };
}

/** Queues `event` to ring, or as missed outside the ringing time. */
function enqueue(state: CallState, event: AgentEvent, missed = false): CallState {
  return missed || !state.ringAllowed
    ? reorder({ ...state, missed: [...state.missed, event] })
    : reorder({ ...state, waiting: [...state.waiting, event] });
}

/** `state` without the reports `ids`; a head that is not on screen gives way to the next one. */
function without(state: CallState, ids: ReadonlySet<string>): CallState {
  const keep = (e: AgentEvent) => !ids.has(e.id);
  const missed = state.missed.filter(keep);
  return onScreen(state)
    ? reorder({ ...state, waiting: state.waiting.filter(keep), missed })
    : reorder({ ...state, current: null, waiting: queued(state).filter(keep), missed });
}

/** Ends the current call: its id leaves `prepared` and the next queued report takes the head. */
function next(state: CallState): CallState {
  const prepared = new Set(state.prepared);
  if (state.current) prepared.delete(state.current.event.id);
  return reorder({ ...state, prepared, current: null });
}

/** Reports that arrived and are not on screen, in ringing order: the calls screen's 未接来电. */
export function missedCalls(state: CallState): AgentEvent[] {
  return [...queued(state), ...state.missed].sort(compareCalls);
}

/** Reports whose speech still has to be synthesized, in the order they will ring. */
export function reportsToPrepare(state: CallState): AgentEvent[] {
  return [...queued(state), ...state.missed].filter((e) => !state.prepared.has(e.id));
}

/** `state` without the calls `ids`, wherever they are: on screen, queued, missed or failed. */
function endElsewhere(state: CallState, ids: ReadonlySet<string>): CallState {
  const knownIds = new Set([...state.knownIds, ...ids]);
  const prepared = new Set([...state.prepared].filter((id) => !ids.has(id)));
  const failed = state.failed.filter((f) => !ids.has(f.event.id));
  const rest = { ...state, knownIds, prepared, failed };
  if (state.current && ids.has(state.current.event.id)) {
    return without({ ...rest, current: null }, ids);
  }
  return without(rest, ids);
}

/** Every call this device holds: on screen or preparing, queued, missed and failed. */
function heldCalls(state: CallState): AgentEvent[] {
  return [
    ...(state.current ? [state.current.event] : []),
    ...state.waiting,
    ...state.missed,
    ...state.failed.map((f) => f.event),
  ];
}

export function callReducer(state: CallState, action: CallAction): CallState {
  switch (action.type) {
    case "arrived": {
      if (state.knownIds.has(action.event.id)) return state;
      const knownIds = new Set(state.knownIds).add(action.event.id);
      return enqueue({ ...state, knownIds }, action.event, action.missed);
    }
    case "eventUpdated": {
      // Update delivery/machine fields on current, waiting and missed events.
      const update = (e: AgentEvent) =>
        e.id === action.update.id ? applyUpdate(e, action.update) : e;
      return {
        ...state,
        current: state.current ? { ...state.current, event: update(state.current.event) } : null,
        waiting: state.waiting.map(update),
        missed: state.missed.map(update),
      };
    }
    case "prepared": {
      const known = missedCalls(state).some((e) => e.id === action.id);
      if (!known || state.prepared.has(action.id)) return state;
      return reorder({ ...state, prepared: new Set(state.prepared).add(action.id) });
    }
    case "prepareFailed": {
      const event = missedCalls(state).find((e) => e.id === action.id);
      if (!event || state.prepared.has(action.id)) return state;
      const failed = [...state.failed, { event, message: action.message }];
      return without({ ...state, failed }, new Set([action.id]));
    }
    case "retryPrepare": {
      const report = state.failed.find((f) => f.event.id === action.id);
      if (!report) return state;
      const failed = state.failed.filter((f) => f !== report);
      return enqueue({ ...state, failed }, report.event);
    }
    case "dropFailed":
      return state.failed.some((f) => f.event.id === action.id)
        ? { ...state, failed: state.failed.filter((f) => f.event.id !== action.id) }
        : state;
    case "ringAllowedChanged": {
      if (state.ringAllowed === action.allowed) return state;
      if (action.allowed) return { ...state, ringAllowed: true };
      // The quiet time starts: everything not answered yet is missed; an active call goes on.
      const { current } = state;
      const active = current?.phase === "active" ? current : null;
      const unanswered = current && !active ? [current.event, ...state.waiting] : state.waiting;
      return reorder({
        ...state,
        ringAllowed: false,
        current: active,
        waiting: [],
        missed: [...state.missed, ...unanswered],
      });
    }
    case "answer": {
      // A missed call is answered straight away, without ringing; the rest keep waiting.
      const event = missedCalls(state).find((e) => e.id === action.id);
      if (onScreen(state) || !event || !state.prepared.has(event.id)) return state;
      const rest = without(state, new Set([event.id]));
      const waiting = rest.current ? [rest.current.event, ...rest.waiting] : rest.waiting;
      return { ...rest, current: { event, phase: "active" }, waiting };
    }
    case "acknowledge": {
      // 全部知悉: the user knows about these missed calls and will not answer them.
      const ids = new Set(action.ids);
      if (!missedCalls(state).some((e) => ids.has(e.id))) return state;
      const prepared = new Set([...state.prepared].filter((id) => !ids.has(id)));
      return without({ ...state, prepared }, ids);
    }
    case "endedElsewhere": {
      const ids = new Set(action.ids);
      const held = heldCalls(state).some((e) => ids.has(e.id));
      const unknown = action.ids.some((id) => !state.knownIds.has(id));
      return held || unknown ? endElsewhere(state, ids) : state;
    }
    case "reconciled": {
      const active = state.current?.phase === "active" ? state.current.event.id : null;
      const ended = heldCalls(state)
        .filter((e) => e.seq <= action.upToSeq && !action.pending.has(e.id) && e.id !== active)
        .map((e) => e.id);
      return ended.length ? endElsewhere(state, new Set(ended)) : state;
    }
    case "accept":
      return state.current?.phase === "ringing"
        ? { ...state, current: { ...state.current, phase: "active" } }
        : state;
    case "decline":
      return state.current?.phase === "ringing" ? next(state) : state;
    case "hangUp":
      return state.current?.phase === "active" ? next(state) : state;
  }
}
