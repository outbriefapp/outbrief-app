import { Phone, PhoneOutgoing, Settings } from "lucide-react";
import type { UnreadableCall } from "../App.tsx";
import type { CallMode, RingSchedule } from "../callModes.ts";
import type { FailedReport } from "../callQueue.ts";
import { callerName, callerSubtitle, projectName } from "../format.ts";
import { useT } from "../i18n/index.ts";
import type { ConnectionStatus } from "../serverClient.ts";
import { ModeMenu } from "./ModeMenu.tsx";

/** `unconfigured`: no server address / token saved yet. */
type IdleStatus = ConnectionStatus | "unconfigured";

export function IdleScreen(props: {
  status: IdleStatus;
  /** Reports whose speech is still being synthesized; they ring once it is done. */
  preparingCount: number;
  modes: CallMode[];
  /** Includes the mode deciding today; its `mode` null: 随时响铃 today. */
  schedule: RingSchedule;
  /** Missed calls ready to answer: prepared reports waiting for the ringing time. */
  missedCount: number;
  /** Uses `modeId` today (null: 随时响铃 today), switching off the mode it replaces. */
  onSwitchMode: (modeId: string | null) => void;
  failed: FailedReport[];
  /** Calls sealed with a key this device does not have: shown, never rung. */
  unreadable: UnreadableCall[];
  /** No end-to-end key yet: calls cannot be opened until it is fixed. */
  keyProblem: string | null;
  /** Android: notifications are off, so calls cannot ring in the background (OUTB-60). */
  notificationsOff: boolean;
  onTurnOnNotifications: () => void;
  onRetry: (eventId: string) => void;
  onDrop: (eventId: string) => void;
  onDropUnreadable: (eventId: string) => void;
  onOpenSettings: () => void;
  /** Opens 设置 → 模式. */
  onManageModes: () => void;
  onOpenHistory: () => void;
  /** Opens 呼叫 Agent: dispatch a task to a Multica agent (YOUT-222). */
  onOpenDispatch: () => void;
}) {
  const msg = useT();
  return (
    <main className="screen idle">
      <header className="idle-header">
        <ModeMenu
          modes={props.modes}
          schedule={props.schedule}
          onSwitchMode={props.onSwitchMode}
          onManageModes={props.onManageModes}
        />
        <div className="header-links">
          <button
            type="button"
            className="icon-button"
            onClick={props.onOpenHistory}
            aria-label={msg.idle.calls}
            title={msg.idle.calls}
          >
            <Phone size={20} aria-hidden />
            {props.missedCount > 0 && <span className="icon-badge">{props.missedCount}</span>}
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={props.onOpenSettings}
            aria-label={msg.idle.settings}
            title={msg.idle.settings}
          >
            <Settings size={20} aria-hidden />
          </button>
        </div>
      </header>
      {props.notificationsOff && (
        <p className="banner idle-banner">
          <span className="idle-banner-text">{msg.idle.notificationsOff}</span>
          <button type="button" className="link" onClick={props.onTurnOnNotifications}>
            {msg.idle.turnOn}
          </button>
        </p>
      )}
      <section className="idle-body">
        <div className={`status-dot ${props.status}`} />
        <p className="idle-title">{msg.idle.status[props.status]}</p>
        {props.keyProblem && <p className="error">{props.keyProblem}</p>}
        {props.preparingCount > 0 && (
          <p className="queue-badge">{msg.idle.preparing(props.preparingCount)}</p>
        )}
        {/* The one thing to do on this page, so it is the round button in the middle rather than a
            third phone icon next to 来电 in the header (YOUT-222). */}
        <button
          type="button"
          className="round accept dispatch-cta"
          onClick={props.onOpenDispatch}
          aria-label={msg.idle.dispatch}
          title={msg.idle.dispatch}
        >
          <PhoneOutgoing size={28} aria-hidden />
        </button>
      </section>
      {props.unreadable.length > 0 && (
        <section className="prepare-failed">
          {props.unreadable.map(({ relayed, message }) => (
            <div key={relayed.id} className="prepare-failed-row">
              <div className="prepare-failed-text">
                <strong>{relayed.machine?.name ?? msg.idle.unknownCaller}</strong>
                <span className="error">{msg.idle.unreadable(message)}</span>
              </div>
              <div className="prepare-failed-actions">
                <button
                  type="button"
                  className="link"
                  onClick={() => props.onDropUnreadable(relayed.id)}
                >
                  {msg.common.ignore}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
      {props.failed.length > 0 && (
        <section className="prepare-failed">
          {props.failed.map(({ event, message }) => (
            <div key={event.id} className="prepare-failed-row">
              <div className="prepare-failed-text">
                <strong>{callerName(event)}</strong>
                <span className="muted">
                  {[projectName(event), callerSubtitle(event)].filter(Boolean).join(" · ")}
                </span>
                <span className="error">{msg.idle.prepareFailed(message)}</span>
              </div>
              <div className="prepare-failed-actions">
                <button type="button" onClick={() => props.onRetry(event.id)}>
                  {msg.common.retry}
                </button>
                <button type="button" className="link" onClick={() => props.onDrop(event.id)}>
                  {msg.common.ignore}
                </button>
              </div>
            </div>
          ))}
        </section>
      )}
    </main>
  );
}
