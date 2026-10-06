import { useState } from "react";
import type { DecisionChoice } from "../call/session.ts";
import type { E2eKey } from "../e2e/crypto.ts";
import { type EventUpdate, openUpdate, sealReply } from "../e2e/events.ts";
import { useT } from "../i18n/index.ts";
import type { AgentEvent } from "../protocol.ts";
import type { ServerSettings } from "../serverClient.ts";
import { sendReply } from "../serverClient.ts";

type SendState = { phase: "idle" } | { phase: "sending" } | { phase: "failed"; error: string };

/** Builds a plain-text reply from the user's recorded words and decision choices. */
function buildReply(
  transcript: { role: string; text: string }[],
  decisions: DecisionChoice[],
): string {
  const words = transcript
    .filter((t) => t.role === "user")
    .map((t) => t.text.trim())
    .filter(Boolean);
  const parts: string[] = [];
  if (words.length) parts.push(words.join("\n"));
  if (decisions.length) {
    parts.push(decisions.map((d) => `${d.question}：${d.choice}`).join("\n"));
  }
  return parts.join("\n\n");
}

/**
 * After hang-up: shows what the user said during the call, lets them edit it, and sends it to the
 * outbrief-daemon of the machine that reported the call. That daemon posts it to Multica (Multica
 * reports, with the token saved on that machine) or resumes the agent session. Shows the live
 * delivery status.
 */
export function ReplyPanel(props: {
  server: ServerSettings;
  e2eKey: E2eKey;
  event: AgentEvent;
  transcript: { role: string; text: string }[];
  decisions: DecisionChoice[];
  /** `updated`: the delivery the server queued; `content`: the text that was sent (sealed). */
  onSent: (updated: EventUpdate, content: string) => void;
  onSkip: () => void;
}) {
  const msg = useT();
  const { server, event, transcript, decisions } = props;
  const [reply, setReply] = useState(() => buildReply(transcript, decisions));
  const [send, setSend] = useState<SendState>({ phase: "idle" });
  const multica = event.multica;
  const delivery = event.delivery;
  const machine = event.machine;
  const isDaemon = !!machine;
  const hasContent = reply.trim().length > 0;

  function doSend() {
    setSend({ phase: "sending" });
    const content = reply.trim();
    sealReply(props.e2eKey, event, content)
      .then((sealed) => sendReply(server, event.id, sealed))
      .then((relayed) => openUpdate(props.e2eKey, relayed))
      .then(
        (updated) => {
          const delivery = updated.delivery && { ...updated.delivery, content };
          props.onSent({ ...updated, delivery }, content);
        },
        (err: unknown) =>
          setSend({
            phase: "failed",
            error: err instanceof Error ? err.message : String(err),
          }),
      );
  }

  // Daemon event: show delivery status once reply was sent.
  if (isDaemon && delivery) {
    const { status, error } = delivery;
    return (
      <section className="summary">
        <h2>{msg.reply.title}</h2>
        <p className="muted">{machine.name}</p>
        <div className={`delivery-status delivery-status--${status}`}>
          <span className="delivery-label">{msg.reply.delivery[status]}</span>
          {status === "queued" && !machine.online && (
            <span className="muted">{msg.reply.offline}</span>
          )}
          {status === "delivered" && (
            <span className="muted">
              {multica ? msg.reply.deliveredMultica : msg.reply.deliveredAgent}
            </span>
          )}
          {status === "failed" && error && (
            <span className="error-text"> · {error.slice(0, 120)}</span>
          )}
        </div>
        <div className="summary-actions">
          <button type="button" className="pill" onClick={props.onSkip}>
            {msg.reply.done}
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="summary">
      <h2>{msg.reply.title}</h2>
      {multica && (
        <p className="muted">
          {multica.issueIdentifier} · {multica.agentName}
        </p>
      )}
      {isDaemon && machine && !multica && <p className="muted">{machine.name}</p>}

      {!hasContent && send.phase === "idle" && <p className="muted">{msg.reply.nothing}</p>}

      {send.phase === "failed" && (
        <div className="error-box">
          <p>{msg.reply.failed(send.error)}</p>
        </div>
      )}

      {send.phase !== "sending" && hasContent && (
        <>
          <textarea
            className="prompt-editor"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            aria-label={msg.reply.content}
          />
          <div className="row-actions">
            <button
              type="button"
              className="pill primary"
              disabled={!reply.trim()}
              onClick={doSend}
            >
              {multica ? msg.reply.toMultica : msg.reply.toAgent}
            </button>
          </div>
        </>
      )}

      {send.phase === "sending" && (
        <div className="summary-loading">
          <span className="spinner" />
          <p className="muted">{msg.reply.sending}</p>
        </div>
      )}

      <div className="summary-actions">
        <button
          type="button"
          className="pill"
          disabled={send.phase === "sending"}
          onClick={props.onSkip}
        >
          {msg.reply.skip}
        </button>
      </div>
    </section>
  );
}
