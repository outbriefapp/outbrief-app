import { type FormEvent, useState } from "react";
import { type DaemonLink, setDaemonE2eKey } from "../daemonLink.ts";
import { formatKey, importKey, keyFromPassphrase, MIN_PASSPHRASE_CHARS } from "../e2e/crypto.ts";
import { errorMessage } from "../format.ts";
import { t, useT } from "../i18n/index.ts";
import { ServerError } from "../serverClient.ts";
import type { AppSettings } from "../settings.ts";

/** What 设置 → 加密 saves on this device. */
export type E2eSettingsPatch = Pick<AppSettings, "e2eKey" | "e2eFromDaemon">;

/**
 * 设置 → 加密. Reports, briefs and replies are encrypted between this device and the
 * outbrief-daemon; the server only relays ciphertext. By default the key follows the daemon on this
 * machine. The user sets one 密钥, a phrase the key is derived from: it changes the key here and,
 * when this machine's daemon is reachable, on the daemon too, so both keep using the same key.
 * Another device scans a 添加设备 QR code, or enters the same phrase. A key is never changed through
 * the server: a phone only changes its own. The derived key and its fingerprint are details the page never shows
 * (YOUT-205); the page only says the key can be changed here and must match the computer's
 * (YOUT-210).
 */
export function E2eSettingsSection(props: {
  /** The daemon on this machine; null on a phone or in a browser. */
  localDaemon: Extract<DaemonLink, { kind: "local" }> | null;
  /** Whether a usable key is in place. */
  hasKey: boolean;
  onSave: (patch: E2eSettingsPatch) => void;
}) {
  const msg = useT();
  const { localDaemon } = props;
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const key = formatKey(await importKey(await keyFromPassphrase(passphrase)));
      // Keep the daemon on this machine on the same key; without one, the key stays on this device.
      let daemonUpdated = false;
      if (localDaemon) {
        try {
          await setDaemonE2eKey(localDaemon, { passphrase });
          daemonUpdated = true;
        } catch (err) {
          if (err instanceof ServerError && err.status !== null) throw err;
        }
      }
      props.onSave({ e2eKey: key, e2eFromDaemon: daemonUpdated });
      setPassphrase("");
      setNotice(daemonUpdated ? msg.e2e.savedWithDaemon : msg.e2e.savedHere);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel">
      <form onSubmit={submit}>
        <p className="muted">{props.hasKey ? msg.e2e.changeKey : msg.e2e.setKey}</p>
        <label>
          {msg.e2e.key}
          <input
            type="password"
            value={passphrase}
            autoComplete="new-password"
            placeholder={msg.e2e.placeholder(MIN_PASSPHRASE_CHARS)}
            onChange={(e) => setPassphrase(e.target.value)}
          />
        </label>
        {error && <p className="warn">{error}</p>}
        {notice && <p className="muted">{notice}</p>}
        <div className="form-actions">
          <button type="submit" disabled={busy}>
            {busy ? msg.e2e.saving : msg.e2e.save}
          </button>
        </div>
      </form>
    </section>
  );
}

/** "跟随本机 outbrief-daemon" / "已设置" / "未设置". */
export function keySummary(fromDaemon: boolean, hasKey: boolean): string {
  const msg = t();
  if (!hasKey) return msg.common.notSet;
  return fromDaemon ? msg.e2e.fromDaemon : msg.e2e.set;
}
