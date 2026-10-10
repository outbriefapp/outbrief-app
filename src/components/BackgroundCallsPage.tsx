import type { CallServiceStatus, SettingsTarget } from "../callService.ts";
import { useT } from "../i18n/index.ts";
import { Switch } from "./ModesPage.tsx";

/**
 * 设置 → 后台来电 (Android, OUTB-60): the switch of the background call service, and what the
 * system lets it do, each with the system page that changes it.
 */
export function BackgroundCallsPage(props: {
  enabled: boolean;
  onEnabled: (enabled: boolean) => void;
  status: CallServiceStatus | null;
  onRequestNotifications: () => void;
  onOpen: (target: SettingsTarget) => void;
}) {
  const m = useT().callService;
  const { status } = props;
  return (
    <>
      <section className="settings-group">
        <ul>
          <li className="background-row">
            <span className="background-row-text">{m.toggle}</span>
            <Switch checked={props.enabled} label={m.toggle} onChange={props.onEnabled} />
          </li>
        </ul>
        <p className="background-hint muted">{m.hint}</p>
      </section>
      {props.enabled && status && (
        <section className="settings-group">
          <ul>
            <StatusRow
              label={m.notifications}
              hint={m.notificationsHint}
              value={status.notifications === "granted" ? m.granted : m.denied}
              ok={status.notifications === "granted"}
              onChange={props.onRequestNotifications}
            />
            <StatusRow
              label={m.fullScreen}
              hint={m.fullScreenHint}
              value={status.fullScreen ? m.granted : m.denied}
              ok={status.fullScreen}
              onChange={() => props.onOpen("fullScreen")}
            />
            <StatusRow
              label={m.popUp}
              hint={m.popUpHint}
              value={status.popUp ? m.granted : m.denied}
              ok={status.popUp}
              onChange={() => props.onOpen("popUp")}
            />
            <StatusRow
              label={m.battery}
              hint={m.batteryHint}
              value={status.unrestricted ? m.unrestricted : m.restricted}
              ok={status.unrestricted}
              onChange={() => props.onOpen("battery")}
            />
          </ul>
        </section>
      )}
    </>
  );
}

function StatusRow(props: {
  label: string;
  hint: string;
  value: string;
  ok: boolean;
  onChange: () => void;
}) {
  const m = useT().callService;
  return (
    <li className="background-row">
      <span className="background-row-text">
        <span>{props.label}</span>
        <span className="background-row-hint muted">{props.hint}</span>
      </span>
      <span className={props.ok ? "background-ok" : "background-warn"}>{props.value}</span>
      {!props.ok && (
        <button type="button" className="link" onClick={props.onChange}>
          {m.change}
        </button>
      )}
    </li>
  );
}
