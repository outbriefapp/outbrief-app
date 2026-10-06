import { t } from "../i18n/index.ts";
import type {
  AgentEvent,
  Delivery,
  RelayedDelivery,
  RelayedEvent,
  SealedReply,
  SealedReport,
} from "../protocol.ts";
import {
  type E2eKey,
  openJson,
  openText,
  REPORT_AAD,
  replyAad,
  replyErrorAad,
  SealedOpenError,
  sealedKeyId,
  sealJson,
} from "./crypto.ts";

/** A relayed call this device cannot open: shown as an error, never rung or read as plaintext. */
export class UnreadableCallError extends Error {
  override name = "UnreadableCallError";
}

function describeOpenError(err: unknown): string {
  if (err instanceof SealedOpenError && err.reason === "wrong_key") {
    return t().e2e.wrongKeyHint(err.message);
  }
  if (err instanceof SealedOpenError) return t().e2e.cannotOpen(err.message);
  return t().e2e.openFailed(err instanceof Error ? err.message : String(err));
}

function isSealedReport(value: unknown): value is SealedReport {
  const v = value as Partial<SealedReport> | null;
  return (
    !!v &&
    typeof v.content === "string" &&
    !!v.brief &&
    typeof v.brief === "object" &&
    typeof v.brief.status === "string"
  );
}

/**
 * Opens a relayed call with the end-to-end key. Throws `UnreadableCallError` (wrong key, tampered,
 * or erased because the call already ended).
 */
export async function openEvent(key: E2eKey, relayed: RelayedEvent): Promise<AgentEvent> {
  if (!relayed.sealed) throw new UnreadableCallError(t().e2e.ended);
  let report: unknown;
  try {
    report = await openJson(key, REPORT_AAD, relayed.sealed);
  } catch (err) {
    throw new UnreadableCallError(describeOpenError(err));
  }
  if (!isSealedReport(report)) throw new UnreadableCallError(t().e2e.badReport);
  const { multica, brief, ...text } = report;
  return {
    id: relayed.id,
    seq: relayed.seq,
    source: relayed.source,
    status: relayed.status,
    occurredAt: relayed.occurredAt,
    receivedAt: relayed.receivedAt,
    ...text,
    brief,
    multica:
      multica && relayed.multica
        ? { ...multica, taskId: relayed.multica.taskId, reply: relayed.multica.reply }
        : undefined,
    machine: relayed.machine,
    delivery: relayed.delivery ? await openDelivery(key, relayed.delivery, "") : undefined,
  };
}

/** A delivery with its failure reason opened; `content` is the reply this device sent, if any. */
export async function openDelivery(
  key: E2eKey,
  delivery: RelayedDelivery,
  content: string,
): Promise<Delivery> {
  return { ...delivery, content, error: await openReplyError(key, delivery) };
}

/**
 * The daemon seals why a reply failed. The server's own reasons (expired) and the daemon's "could
 * not open the reply" hold no content and come in the clear.
 */
async function openReplyError(key: E2eKey, delivery: RelayedDelivery): Promise<string | null> {
  const { error } = delivery;
  if (!error || !sealedKeyId(error)) return error;
  try {
    return await openText(key, replyErrorAad(delivery.id), error);
  } catch (err) {
    return describeOpenError(err);
  }
}

/** The reply as the daemon of `event`'s machine opens it: text plus where it goes. */
export function sealReply(key: E2eKey, event: AgentEvent, content: string): Promise<string> {
  const reply: SealedReply = {
    content,
    sessionId: event.sessionId ?? null,
    multica: event.multica
      ? {
          workspaceId: event.multica.workspaceId,
          issueId: event.multica.issueId,
          reportCommentId: event.multica.reportCommentId,
        }
      : null,
  };
  return sealJson(key, replyAad(event.id), reply);
}

/** What a relayed update can still change on a call: the machine, the reply delivery, the comment. */
export interface EventUpdate {
  id: string;
  machine?: AgentEvent["machine"];
  /** `content` is empty: the server never has the reply text. */
  delivery?: Delivery;
  multicaReply?: NonNullable<AgentEvent["multica"]>["reply"];
}

/** Opens what a relayed update (reply sent, delivery changed) says about a call. */
export async function openUpdate(key: E2eKey, relayed: RelayedEvent): Promise<EventUpdate> {
  return {
    id: relayed.id,
    machine: relayed.machine,
    delivery: relayed.delivery ? await openDelivery(key, relayed.delivery, "") : undefined,
    multicaReply: relayed.multica?.reply ?? null,
  };
}

/** `event` with `update` merged in; the reply text sent from this device is kept. */
export function applyUpdate(event: AgentEvent, update: EventUpdate): AgentEvent {
  return {
    ...event,
    machine: update.machine ?? event.machine,
    delivery: update.delivery
      ? { ...update.delivery, content: update.delivery.content || event.delivery?.content || "" }
      : event.delivery,
    multica: event.multica
      ? { ...event.multica, reply: update.multicaReply ?? event.multica.reply }
      : event.multica,
  };
}
