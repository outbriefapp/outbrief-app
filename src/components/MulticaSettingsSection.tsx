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
import type { MulticaSettings, MulticaSettingsResponse, MulticaWorkspace } from "../protocol.ts";

/** Refresh while the section is open, so "正在连接…" turns into the real state. */
const STATUS_REFRESH_MS = 3_000;

/**
 * The user's own Multica API token, saved by an outbrief-daemon on its machine only (the one on this
 * machine, or on a phone the computer picked in 设置 → 设备, sealed through the server): the daemon
 * checks it with Multica, listens to every chosen workspace and posts the user's replies with it.
 * The server never sees the token, and it is never shown again, only its hint. The workspaces can
 * be changed later without the token: the daemon keeps the saved one.
 */
export function MulticaSettingsSection(props: { daemon: DaemonLink }) {
  const msg = useT();
  const { daemon } = props;
  const [current, setCurrent] = useState<MulticaSettingsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "token": a new token (and its workspaces); "workspaces": only the workspaces, saved token kept.
  const [editing, setEditing] = useState<"token" | "workspaces" | null>(null);
  const [token, setToken] = useState("");
  const [workspaces, setWorkspaces] = useState<MulticaWorkspace[] | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [busy, setBusy] = useState<"verify" | "save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
  const showForm = editing !== null || (current !== null && saved === null);
  const tokenForm = showForm && editing !== "workspaces";

  function changeToken(value: string) {
    setToken(value);
    setWorkspaces(null);
    setError(null);
  }

  /** Lists what the token (the saved one when none is typed) reaches, keeping the saved choice. */
  function verify(withToken: string | undefined) {
    setBusy("verify");
    setError(null);
    listMulticaWorkspaces(daemon, withToken).then(
      (list) => {
        setBusy(null);
        setWorkspaces(list);
        if (list.length === 0) {
          setError(msg.multica.noWorkspaces);
          return;
        }
        const kept = savedWorkspaceIds(saved).filter((id) => list.some((w) => w.id === id));
        setChosen(kept.length ? kept : [(list[0] as MulticaWorkspace).id]);
      },
      (err: unknown) => {
        setBusy(null);
        setError(multicaErrorText(err));
      },
    );
  }

  function toggle(id: string, on: boolean) {
    // Kept in the listed order: the first is where dispatches go by default.
    setChosen((ids) =>
      (workspaces ?? []).map((w) => w.id).filter((wid) => (wid === id ? on : ids.includes(wid))),
    );
  }

  function save() {
    const first = chosen[0];
    if (!first) return;
    setBusy("save");
    setError(null);
    setNotice(null);
    const trimmed = token.trim();
    saveMulticaSettings(daemon, {
      ...(editing === "workspaces" ? {} : { token: trimmed }),
      workspaceIds: chosen,
      workspaceId: first,
    }).then(
      (next) => {
        setBusy(null);
        setCurrent(next);
        setEditing(null);
        changeToken("");
        // An older daemon reads only `workspaceId`.
        if (chosen.length > 1 && !next.settings?.workspaces) setNotice(msg.multica.oldDaemon);
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
        setEditing(null);
        changeToken("");
      },
      (err: unknown) => {
        setBusy(null);
        setError(multicaErrorText(err));
      },
    );
  }

  function cancel() {
    setEditing(null);
    changeToken("");
  }

  function changeWorkspaces() {
    setEditing("workspaces");
    changeToken("");
    verify(undefined);
  }

  // Enter means "验证" first, then "保存".
  function onTokenKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (workspaces?.length) save();
    else if (token.trim()) verify(token.trim());
  }

  const statuses = current?.status.workspaces ?? [];

  return (
    <section className="settings-panel">
      {current === null && !loadError && <p className="muted">{msg.multica.loading}</p>}
      {loadError && <p className="warn">{msg.multica.loadFailed(loadError)}</p>}
      {saved && !editing && (
        <>
          <p className="muted">
            {msg.multica.workspaceIs(
              saved.workspaces?.map((w) => w.name).join(msg.multica.nameSeparator) ??
                saved.workspaceName,
            )}{" "}
            · {msg.multica.token} <span className="mono">{saved.tokenHint}</span>
          </p>
          {current && statuses.length > 1 ? (
            <ul className="multica-workspace-status">
              {statuses.map((w) => (
                <li key={w.workspaceId} className={w.error ? "warn" : "muted"}>
                  {w.workspaceName}:{" "}
                  {w.error ?? (w.connected ? msg.multica.connected : msg.multica.connecting)}
                </li>
              ))}
            </ul>
          ) : (
            current && (
              <p className={current.status.error ? "warn" : "muted"}>
                {multicaStatusText(current.status)}
              </p>
            )
          )}
          <div className="inline-row">
            {saved.workspaces && (
              <button
                type="button"
                className="pill"
                disabled={busy !== null}
                onClick={changeWorkspaces}
              >
                {msg.multica.changeWorkspaces}
              </button>
            )}
            <button
              type="button"
              className="pill"
              disabled={busy !== null}
              onClick={() => setEditing("token")}
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
          {tokenForm && (
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
          )}
          {!tokenForm && busy === "verify" && <p className="muted">{msg.multica.loading}</p>}
          {workspaces && workspaces.length > 0 && (
            <fieldset className="multica-workspaces">
              <legend>{msg.multica.workspaces}</legend>
              {workspaces.map((w) => (
                <label key={w.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={chosen.includes(w.id)}
                    onChange={(e) => toggle(w.id, e.target.checked)}
                  />
                  {w.name}
                </label>
              ))}
              <span className="muted">{msg.multica.workspacesHelp}</span>
            </fieldset>
          )}
          <div className="inline-row">
            {workspaces?.length ? (
              <button
                type="button"
                className="pill primary"
                disabled={busy !== null || !chosen.length}
                onClick={save}
              >
                {busy === "save"
                  ? msg.multica.savingToken
                  : tokenForm
                    ? msg.multica.saveToken
                    : msg.multica.saveWorkspaces}
              </button>
            ) : (
              tokenForm && (
                <button
                  type="button"
                  className="pill primary"
                  disabled={busy !== null || !token.trim()}
                  onClick={() => verify(token.trim())}
                >
                  {busy === "verify" ? msg.multica.verifying : msg.multica.verifyToken}
                </button>
              )
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
      {notice && <p className="warn">{notice}</p>}
    </section>
  );
}

/** The workspaces the daemon listens to now (one, from a daemon that knows only one). */
function savedWorkspaceIds(saved: MulticaSettings | null): string[] {
  if (!saved) return [];
  return saved.workspaces?.map((w) => w.id) ?? [saved.workspaceId];
}
