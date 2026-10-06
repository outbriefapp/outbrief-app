import { callerName, callerSubtitle, projectName } from "../format.ts";
import { useT } from "../i18n/index.ts";
import type { AgentEvent } from "../protocol.ts";

export function IncomingCall(props: {
  event: AgentEvent;
  waitingCount: number;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const msg = useT();
  const { event } = props;
  const project = projectName(event);
  return (
    <main className="screen call">
      <section className="caller">
        <div className="avatar ringing">{callerName(event).slice(0, 1)}</div>
        {project && <p className="project-name">{project}</p>}
        <h1>{callerName(event)}</h1>
        <p className="muted">{callerSubtitle(event)}</p>
        <p className="hint">{msg.incoming.invite}</p>
      </section>
      {props.waitingCount > 0 && (
        <p className="queue-badge">{msg.incoming.waiting(props.waitingCount)}</p>
      )}
      <footer className="call-actions">
        <button
          type="button"
          className="round decline"
          onClick={props.onDecline}
          aria-label={msg.incoming.decline}
        >
          ✕
        </button>
        <button
          type="button"
          className="round accept"
          onClick={props.onAccept}
          aria-label={msg.incoming.accept}
        >
          ✆
        </button>
      </footer>
    </main>
  );
}
