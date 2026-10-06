import { useEffect, useState } from "react";
import { fetchDaemonE2eKey } from "../daemonLink.ts";
import { t } from "../i18n/index.ts";
import type { AppSettings } from "../settings.ts";
import { type E2eKey, importKey, parseKeyText } from "./crypto.ts";

export type E2eKeyState =
  | { phase: "loading" }
  | { phase: "ready"; key: E2eKey }
  /** No usable key: the daemon could not be reached and none is saved, or the saved one is invalid. */
  | { phase: "missing"; message: string };

/**
 * The end-to-end key calls are opened and replies sealed with. On a machine with an outbrief-daemon
 * it follows that daemon (`GET /e2e/key` with the local key, on start), remembering it in the
 * settings so the app still opens calls while the daemon restarts. A key this device got another
 * way (`e2eFromDaemon: false`: a scanned QR code, a passphrase, a new account's random key) is used
 * as it is.
 */
export function useE2eKey(
  settings: AppSettings,
  /** The local daemon's key file (`useLocalDaemonKey`); null when there is no daemon here. */
  localKey: string | null | undefined,
  onDaemonKey: (key: string) => void,
): E2eKeyState {
  const [state, setState] = useState<E2eKeyState>({ phase: "loading" });
  const { e2eKey, e2eFromDaemon } = settings;

  // Follow the local daemon's key.
  useEffect(() => {
    if (!e2eFromDaemon || !localKey) return;
    const ctrl = new AbortController();
    fetchDaemonE2eKey({ kind: "local", localKey }, ctrl.signal).then(
      (daemon) => {
        if (!ctrl.signal.aborted && daemon.key !== e2eKey) onDaemonKey(daemon.key);
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn("[outbrief] daemon e2e key", err);
        if (!e2eKey) {
          setState({
            phase: "missing",
            message: t().e2e.daemonDown,
          });
        }
      },
    );
    return () => ctrl.abort();
  }, [e2eFromDaemon, localKey, e2eKey, onDaemonKey]);

  // Import whatever key is current.
  useEffect(() => {
    if (!e2eKey) {
      // Following a daemon: wait for it, unless there is none on this machine.
      if (!e2eFromDaemon || localKey === null) {
        setState({ phase: "missing", message: t().e2e.missing });
      }
      return;
    }
    const raw = parseKeyText(e2eKey);
    if (!raw) {
      setState({
        phase: "missing",
        message: t().e2e.badSaved,
      });
      return;
    }
    let cancelled = false;
    importKey(raw).then(
      (key) => !cancelled && setState({ phase: "ready", key }),
      (err: unknown) => !cancelled && setState({ phase: "missing", message: String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [e2eKey, e2eFromDaemon, localKey]);

  return state;
}
