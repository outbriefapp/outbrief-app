import { type KeyboardEvent, useEffect, useState } from "react";
import {
  type DaemonLink,
  fetchMulticaSettings,
  listMulticaWorkspaces,
  removeMulticaSettings,
  saveMulticaSettings,
} from "../daemonLink.ts";
import { useT } from "../i18n/index.ts";
import { multicaErrorText, multicaStatusText } from "../multicaSettings.ts";
import type { MulticaSettingsResponse, MulticaWorkspace } from "../protocol.ts";

/** Refresh while the section is open, so "正在连接…" turns into the real state. */
const STATUS_REFRESH_MS = 3_000;

/**
 * The user's own Multica API token, saved by an outbrief-daemon on its machine only (the one on this
 * machine, or on a phone the computer picked in 设置 → 设备, sealed through the server): the daemon
 * checks it with Multica, listens to the chosen workspace and posts the user's replies with it. The
 * server never sees the token, and it is never shown again, only its hint.
 */
export function MulticaSettingsSection(props: { daemon: DaemonLink }) {
  const msg = useT();
  const { daemon } = props;
  const [current, setCurrent] = useState<MulticaSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<MulticaWorkspace[] | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState<"verify" | "save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const load = () =>
      fetchMulticaSettings(daemon, ctrl.signal).then(
        (next) => {
          if (ctrl.signal.aborted) return;
          setCurrent(next);
          setLoadError(null);
        },
        (err: unknown) => !ctrl.signal.aborted && setLoadError(multicaErrorText(err)),
      );
    void load();
    const timer = setInterval(load, STATUS_REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [daemon]);

  const saved = current?.settings ?? null;
  const showForm = editing || (current !== null && saved === null);

  function changeToken(value: string) {
    setToken(value);
    setWorkspaces(null);
    setError(null);
  }

  function verify() {
    const trimmed = token.trim();
    if (!trimmed) return;
    setBusy("verify");
    setError(null);
    listMulticaWorkspaces(daemon, trimmed).then(
      (list) => {
        setBusy(null);
        setWorkspaces(list);
        if (list.length === 0) {
          setError(msg.multica.noWorkspaces);
          return;
        }
        // Keep the saved workspace when the new token still reaches it.
        setWorkspaceId((list.find((w) => w.id === saved?.workspaceId) ?? list[0])?.id ?? "");
      },
      (err: unknown) => {
        setBusy(null);
        setError(multicaErrorText(err));
      },
    );
  }

  function save() {
    if (!workspaceId) return;
    setBusy("save");
    setError(null);
    saveMulticaSettings(daemon, { token: token.trim(), workspaceId }).then(
      (next) => {
        setBusy(null);
        setCurrent(next);
        setEditing(false);
        changeToken("");
      },
      (err: unknown) => {
        setBusy(null);
        setError(multicaErrorText(err));
      },
    );
  }

  function remove() {
    setBusy("remove");
    setError(null);
    removeMulticaSettings(daemon).then(
      () => {
        setBusy(null);
        setCurrent({
          settings: null,
          status: { configured: false, connected: false, error: null },
        });
        setEditing(false);
        changeToken("");
      },
      (err: unknown) => {
        setBusy(null);
        setError(multicaErrorText(err));
      },
    );
  }

  function cancel() {
    setEditing(false);
    changeToken("");
  }

  // Enter means "验证" first, then "保存".
  function onTokenKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (workspaces?.length) save();
    else verify();
  }

  return (
    <section className="settings-panel">
      {current === null && !loadError && <p className="muted">{msg.multica.loading}</p>}
      {loadError && <p className="warn">{msg.multica.loadFailed(loadError)}</p>}
      {saved && !editing && (
        <>
          <p className="muted">
            {msg.multica.workspaceIs(saved.workspaceName)} · {msg.multica.token}{" "}
            <span className="mono">{saved.tokenHint}</span>
          </p>
          {current && (
            <p className={current.status.error ? "warn" : "muted"}>
              {multicaStatusText(current.status)}
            </p>
          )}
          <div className="inline-row">
            <button
              type="button"
              className="pill"
              disabled={busy !== null}
              onClick={() => setEditing(true)}
            >
              {msg.multica.changeToken}
            </button>
            <button type="button" className="pill" disabled={busy !== null} onClick={remove}>
              {busy === "remove" ? msg.multica.removing : msg.multica.remove}
            </button>
          </div>
        </>
      )}
      {showForm && (
        <>
          <label>
            Multica API Token
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="mul_…"
              value={token}
              onChange={(e) => changeToken(e.target.value)}
              onKeyDown={onTokenKey}
            />
            <span className="muted">
              {msg.multica.tokenHelp}
              {msg.multica.tokenNote}
            </span>
          </label>
          {workspaces && workspaces.length > 0 && (
            <label>
              {msg.multica.workspace}
              <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="inline-row">
            {workspaces?.length ? (
              <button
                type="button"
                className="pill primary"
                disabled={busy !== null || !workspaceId}
                onClick={save}
              >
                {busy === "save" ? msg.multica.savingToken : msg.multica.saveToken}
              </button>
            ) : (
              <button
                type="button"
                className="pill primary"
                disabled={busy !== null || !token.trim()}
                onClick={verify}
              >
                {busy === "verify" ? msg.multica.verifying : msg.multica.verifyToken}
              </button>
            )}
            {saved && (
              <button type="button" className="pill" disabled={busy !== null} onClick={cancel}>
                {msg.common.cancel}
              </button>
            )}
          </div>
        </>
      )}
      {error && <p className="warn">{error}</p>}
    </section>
  );
}
