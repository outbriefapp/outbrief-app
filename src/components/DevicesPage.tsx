import { Laptop, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { AccountPatch } from "../account.ts";
import { confirmAction } from "../confirm.ts";
import { errorMessage, formatDateTime } from "../format.ts";
import { useT } from "../i18n/index.ts";
import { formatPairingCode, pairingLink } from "../pairing.ts";
import type { Device, PairingCode } from "../protocol.ts";
import {
  createPairingCode,
  fetchPairingStatus,
  listDevices,
  removeDevice,
  type ServerSettings,
} from "../serverClient.ts";
import { JoinForm } from "./JoinForm.tsx";
import { QrCode } from "./QrCode.tsx";

const STATUS_POLL_MS = 2_000;
/** How long a pairing code is valid (outbrief-server `PAIRING_CODE_TTL_MS`). */
const PAIRING_MINUTES = 10;

/**
 * 设置 → 设备: the devices of this anonymous account, each with its own token (outbrief-server
 * ADR 0008). Remove one (its token stops working at once), add one with a QR code / pairing code,
 * or move this device to another account.
 */
export function DevicesPage(props: {
  server: ServerSettings;
  /** This device's end-to-end key (`obk1_…`), carried by the QR code; empty when it has none. */
  e2eKey: string;
  /** This device was removed from the account (by itself): it needs a new one. */
  onLeft: () => void;
  /** This device moved to another account. */
  onSwitched: (patch: AccountPatch) => void;
}) {
  const msg = useT();
  const m = msg.devices;
  const { server } = props;
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  // A new round remounts the add-device panel with a fresh code.
  const [round, setRound] = useState(0);
  const [joining, setJoining] = useState(false);

  const load = useCallback(
    (signal?: AbortSignal) =>
      listDevices(server, signal).then(
        (list) => !signal?.aborted && setDevices(list),
        (err: unknown) => !signal?.aborted && setError(m.loadFailed(errorMessage(err))),
      ),
    [server, m],
  );
  useEffect(() => {
    const ctrl = new AbortController();
    void load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  async function remove(device: Device) {
    const question = device.current ? m.leaveConfirm : m.removeConfirm(device.name);
    if (!(await confirmAction(question))) return;
    try {
      await removeDevice(server, device.id);
      if (device.current) props.onLeft();
      else await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function switchAccount(patch: AccountPatch) {
    // Leave the current account first, so this device does not linger in it.
    const me = devices?.find((d) => d.current);
    if (me) await removeDevice(server, me.id).catch((err: unknown) => console.warn(err));
    props.onSwitched(patch);
  }

  return (
    <section className="settings-panel">
      <p className="muted">{m.intro}</p>
      <p className="muted">{m.server(new URL(server.serverUrl).host)}</p>
      {error && <p className="warn">{error}</p>}
      {devices === null && !error && <p className="muted">{m.loading}</p>}
      {devices && (
        <ul className="device-list">
          {devices.map((d) => (
            <li key={d.id} className="device-row">
              {d.kind === "daemon" ? (
                <Laptop size={20} aria-hidden />
              ) : (
                <Smartphone size={20} aria-hidden />
              )}
              <div className="device-info">
                <span>
                  {d.name}
                  {d.current && <span className="device-tag">{m.current}</span>}
                </span>
                <span className="device-meta">
                  {m.kind[d.kind]} ·{" "}
                  {d.online
                    ? m.online
                    : d.lastSeenAt
                      ? m.lastSeen(formatDateTime(d.lastSeenAt))
                      : m.offline}
                </span>
              </div>
              <button type="button" className="secondary danger" onClick={() => void remove(d)}>
                {m.remove}
              </button>
            </li>
          ))}
        </ul>
      )}

      {adding ? (
        <AddDevice
          key={round}
          server={server}
          onRenew={() => setRound((r) => r + 1)}
          e2eKey={props.e2eKey}
          onJoined={() => void load()}
          onClose={() => setAdding(false)}
        />
      ) : (
        <div className="form-actions">
          <button type="button" className="secondary" onClick={() => setJoining((v) => !v)}>
            {m.joinOther}
          </button>
          <button type="button" onClick={() => setAdding(true)}>
            {m.add}
          </button>
        </div>
      )}

      {joining && !adding && (
        <section className="settings-group">
          <h2>{m.joinOther}</h2>
          <p className="muted">{m.joinOtherIntro}</p>
          <JoinForm
            serverUrl={server.serverUrl}
            currentKey={props.e2eKey}
            onJoined={switchAccount}
            submitLabel={m.joinOther}
          />
        </section>
      )}
    </section>
  );
}

/**
 * A pairing code with its QR code: the QR code carries the server address, the code and this
 * device's end-to-end key, device to device. Waits for the new device and says who joined.
 */
function AddDevice(props: {
  server: ServerSettings;
  e2eKey: string;
  onJoined: () => void;
  onRenew: () => void;
  onClose: () => void;
}) {
  const msg = useT();
  const m = msg.devices;
  const { server, onJoined } = props;
  const [code, setCode] = useState<PairingCode | null>(null);
  const [joined, setJoined] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    createPairingCode(server).then(
      (next) => {
        if (cancelled) return;
        setCode(next);
        setNow(Date.now());
      },
      (err: unknown) => !cancelled && setError(errorMessage(err)),
    );
    return () => {
      cancelled = true;
    };
  }, [server]);

  // Count down, and watch for the new device.
  useEffect(() => {
    if (!code || joined) return;
    const ctrl = new AbortController();
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= Date.parse(code.expiresAt)) return;
      fetchPairingStatus(server, code.code, ctrl.signal).then(
        (status) => {
          if (ctrl.signal.aborted || !status.usedBy) return;
          setJoined(status.usedBy.name);
          onJoined();
        },
        () => undefined,
      );
    }, STATUS_POLL_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [server, code, joined, onJoined]);

  const link =
    code && props.e2eKey
      ? pairingLink({ serverUrl: server.serverUrl, code: code.code, key: props.e2eKey })
      : null;
  // Clamped: this device's clock may run a little behind the server's.
  const minutesLeft = code
    ? Math.min(PAIRING_MINUTES, Math.ceil((Date.parse(code.expiresAt) - now) / 60_000))
    : 0;
  const expired = !!code && minutesLeft <= 0;

  async function copy() {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    setCopied(true);
  }

  return (
    <section className="settings-group add-device">
      <h2>{m.add}</h2>
      {error && <p className="warn">{error}</p>}
      {joined ? (
        <p className="notice">{m.joined(joined)}</p>
      ) : (
        code && (
          <>
            <p className="muted">{m.addIntro}</p>
            {link && !expired && <QrCode text={link} label={m.add} />}
            {!props.e2eKey && <p className="warn">{m.noKey}</p>}
            <p className="pairing-code">
              <span className="muted">{m.code}</span>
              <strong className="mono">{expired ? "——— ———" : formatPairingCode(code.code)}</strong>
              <span className="muted">{expired ? m.expired : m.expiresIn(minutesLeft)}</span>
            </p>
            {link && !expired && (
              <>
                <p className="muted">{m.daemonHint}</p>
                <code className="pairing-command">outbrief-daemon login '{link}'</code>
              </>
            )}
          </>
        )
      )}
      <div className="form-actions">
        <button type="button" className="secondary" onClick={props.onClose}>
          {msg.common.back}
        </button>
        {link && !expired && !joined && (
          <button type="button" className="secondary" onClick={() => void copy()}>
            {copied ? m.copied : m.copyLink}
          </button>
        )}
        {(expired || joined) && (
          <button type="button" onClick={props.onRenew}>
            {m.newCode}
          </button>
        )}
      </div>
    </section>
  );
}
