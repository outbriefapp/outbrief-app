import type { AgentEvent, CallOutcome } from "../protocol.ts";
import type { ChatTurn, DecisionChoice } from "./session.ts";

const PREFIX = "outbrief.call.";
export const MAX_RECORDS = 100;

/**
 * One finished call, kept only on this device: the history. The server erases the report and
 * brief once the call ends and keeps no reply text (outbrief-server ADR 0006).
 */
export interface CallRecord {
  eventId: string;
  savedAt: string;
  /** The call as it rang (report, brief, 称呼 filled in); `status` is how it ended. */
  event: AgentEvent;
  transcript: ChatTurn[];
  decisions: DecisionChoice[];
  /** The reply sent from this device, if any. */
  reply: string | null;
}

/** Records written before history moved to the device have no `event`; they are not history. */
function isRecord(value: unknown): value is CallRecord {
  const r = value as Partial<CallRecord> | null;
  return (
    !!r &&
    typeof r.eventId === "string" &&
    typeof r.savedAt === "string" &&
    !!r.event &&
    typeof r.event.id === "string" &&
    Array.isArray(r.transcript) &&
    Array.isArray(r.decisions)
  );
}

export function loadCallRecord(eventId: string): CallRecord | null {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(PREFIX + eventId) ?? "null");
    return isRecord(parsed) ? { ...parsed, reply: parsed.reply ?? null } : null;
  } catch {
    return null;
  }
}

/** Every saved call, newest first (by when it arrived). */
export function listCallRecords(): CallRecord[] {
  const records: CallRecord[] = [];
  for (const key of recordKeys()) {
    const record = loadCallRecord(key.slice(PREFIX.length));
    if (record) records.push(record);
  }
  return records.sort((a, b) => b.event.receivedAt.localeCompare(a.event.receivedAt));
}

/** A new record for a call that just ended as `outcome`. */
export function endedCall(
  event: AgentEvent,
  outcome: CallOutcome,
  call: Partial<Pick<CallRecord, "transcript" | "decisions" | "reply">> = {},
): CallRecord {
  return {
    eventId: event.id,
    savedAt: new Date().toISOString(),
    event: { ...event, status: outcome },
    transcript: call.transcript ?? [],
    decisions: call.decisions ?? [],
    reply: call.reply ?? null,
  };
}

/**
 * Stores `record` under `outbrief.call.<eventId>`, keeping the newest `MAX_RECORDS`. When storage
 * is full the oldest records make room; a record that does not fit alone is not saved (throws).
 */
export function saveCallRecord(record: CallRecord): void {
  const value = JSON.stringify(record);
  const keep = recordKeys()
    .filter((key) => key !== PREFIX + record.eventId)
    .map((key) => ({ key, savedAt: savedAtOf(key) }))
    .sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  while (keep.length >= MAX_RECORDS) removeOldest(keep);
  for (;;) {
    try {
      localStorage.setItem(PREFIX + record.eventId, value);
      return;
    } catch (err) {
      if (!isQuotaError(err) || !keep.length) throw err;
      removeOldest(keep);
    }
  }
}

/** Applies `change` to a saved record; no-op when this device has no record of that call. */
export function updateCallRecord(eventId: string, change: (r: CallRecord) => CallRecord): void {
  const record = loadCallRecord(eventId);
  if (record) saveCallRecord(change(record));
}

function recordKeys(): string[] {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

function savedAtOf(key: string): string {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as { savedAt?: unknown } | null;
    return typeof parsed?.savedAt === "string" ? parsed.savedAt : "";
  } catch {
    return "";
  }
}

function removeOldest(keep: { key: string }[]): void {
  const oldest = keep.shift();
  if (oldest) localStorage.removeItem(oldest.key);
}

function isQuotaError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "QuotaExceededError";
}
