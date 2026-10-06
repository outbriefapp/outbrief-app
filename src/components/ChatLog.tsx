import { useEffect, useRef } from "react";
import type { ChatTurn, PendingAnswer } from "../call/session.ts";
import { useT } from "../i18n/index.ts";

/** Q&A bubbles, newest at the bottom; `pending` is the answer still streaming (or broken). */
export function ChatLog(props: {
  turns: ChatTurn[];
  pending?: PendingAnswer | null;
  onRetry?: () => void;
}) {
  const msg = useT();
  const { turns, pending } = props;
  const ref = useRef<HTMLDivElement>(null);
  const pendingText = pending?.text;
  // Follow the conversation as turns arrive and the answer streams in.
  useEffect(() => {
    if (turns.length || pendingText !== undefined)
      ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [turns.length, pendingText]);

  if (!turns.length && !pending) return null;
  return (
    <div className="chat" ref={ref}>
      {turns.map((t, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: turns are append-only, so the index is stable
        <p key={i} className={`bubble ${t.role}`}>
          {t.text}
        </p>
      ))}
      {pending && (
        <div className="bubble assistant">
          {pending.text ||
            (pending.error !== null ? "" : <span className="typing">{msg.call.thinking}</span>)}
          {pending.error !== null && (
            <div className="bubble-error">
              {pending.error}
              {props.onRetry && (
                <button type="button" className="pill" onClick={props.onRetry}>
                  {msg.common.retry}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
