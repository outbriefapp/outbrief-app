import type { DecisionChoice, PlaybackSegment } from "../call/session.ts";
import { useT } from "../i18n/index.ts";
import type { BriefDecision } from "../protocol.ts";

/** The card of the segment being spoken, with dots / prev / next to flip (audio follows). */
export function CallCard(props: {
  segments: PlaybackSegment[];
  index: number;
  onJump: (index: number) => void;
}) {
  const msg = useT();
  const { segments, index } = props;
  const seg = segments[index];
  if (!seg) return null;
  return (
    <article className="brief-card">
      <h2>{seg.card.title}</h2>
      {seg.body !== null ? (
        <pre>{seg.body}</pre>
      ) : (
        <ul>
          {seg.card.bullets.map((b, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a card's bullets never change
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
      {segments.length > 1 && (
        <nav className="card-nav">
          <button
            type="button"
            className="nav-arrow"
            disabled={index === 0}
            onClick={() => props.onJump(index - 1)}
            aria-label={msg.card.prev}
          >
            ‹
          </button>
          <div className="dots">
            {segments.map((s, i) => (
              <button
                key={s.id}
                type="button"
                className={i === index ? "dot current" : "dot"}
                onClick={() => props.onJump(i)}
                aria-label={msg.card.nth(i + 1)}
              />
            ))}
          </div>
          <button
            type="button"
            className="nav-arrow"
            disabled={index === segments.length - 1}
            onClick={() => props.onJump(index + 1)}
            aria-label={msg.card.next}
          >
            ›
          </button>
        </nav>
      )}
    </article>
  );
}

/** Questions the agent left open; the recommended option is highlighted, the chosen one marked. */
export function DecisionPanel(props: {
  decisions: BriefDecision[];
  choices: DecisionChoice[];
  onChoose: (decisionId: string, label: string) => void;
}) {
  const msg = useT();
  if (!props.decisions.length) return null;
  return (
    <section className="decisions">
      <h3>{msg.card.decide}</h3>
      {props.decisions.map((d) => {
        const chosen = props.choices.find((c) => c.decisionId === d.id)?.choice;
        return (
          <div key={d.id} className="decision">
            <p className="decision-question">{d.question}</p>
            <div className="options">
              {d.options.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  className={[
                    "option",
                    o.id === d.recommendedOptionId ? "recommended" : "",
                    chosen === o.label ? "chosen" : "",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => props.onChoose(d.id, o.label)}
                >
                  {o.label}
                  {o.id === d.recommendedOptionId && (
                    <span className="tag">{msg.card.recommended}</span>
                  )}
                </button>
              ))}
            </div>
            {d.reason && <p className="decision-reason">{d.reason}</p>}
          </div>
        );
      })}
    </section>
  );
}
