import { type FormEvent, useState } from "react";
import {
  type AccountPatch,
  accountErrorText,
  type Bootstrap,
  createOwnAccount,
} from "../account.ts";
import { useT } from "../i18n/index.ts";
import { JoinForm } from "./JoinForm.tsx";

/**
 * A device without an account (outbrief-server ADR 0008): create one, or join an existing one with
 * a pairing code. Most devices never see this: they join their local daemon's account or create one
 * by themselves. It shows on a claimed private server, after this device was removed, or while
 * waiting for this machine's daemon.
 */
export function WelcomeScreen(props: {
  state: Extract<Bootstrap, { phase: "welcome" }>;
  serverUrl: string;
  currentKey: string;
  removed: boolean;
  onServerUrl: (serverUrl: string) => void;
  onJoined: (patch: AccountPatch) => void;
}) {
  const msg = useT();
  const m = msg.account;
  const { state } = props;
  const [serverUrl, setServerUrl] = useState(props.serverUrl);
  const [claimCode, setClaimCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const validUrl = /^https?:\/\/[^/]/.test(serverUrl.trim()) && URL.canParse(serverUrl.trim());

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!validUrl) return setError(m.urlInvalid);
    if (state.signup === "claim" && !claimCode.trim()) return setError(m.claimRequired);
    setBusy(true);
    setError(null);
    try {
      props.onJoined(
        await createOwnAccount(serverUrl.trim(), props.currentKey, claimCode.trim() || undefined),
      );
    } catch (err) {
      setError(accountErrorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="screen settings welcome">
      <header className="idle-header">
        <span className="brand">{m.welcomeTitle}</span>
      </header>
      <div className="settings-page">
        <section className="settings-panel">
          {props.removed && <p className="warn">{m.removed}</p>}
          {state.waitingForDaemon && <p className="notice">{m.waitingDaemon}</p>}
          {state.problem && <p className="warn">{state.problem}</p>}
          <p className="muted">{m.welcomeIntro}</p>
          <label>
            {m.server}
            <input
              value={serverUrl}
              placeholder="http://localhost:8787"
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => {
                setServerUrl(e.target.value);
                setError(null);
              }}
              onBlur={() => {
                const url = serverUrl.trim();
                if (url !== props.serverUrl && validUrl) props.onServerUrl(url);
              }}
            />
          </label>
        </section>

        <section className="settings-group">
          <h2>{m.joinTitle}</h2>
          <p className="muted">{m.joinIntro}</p>
          <JoinForm
            serverUrl={serverUrl.trim()}
            currentKey={props.currentKey}
            onJoined={props.onJoined}
          />
        </section>

        <section className="settings-group">
          <h2>{m.create}</h2>
          {state.signup === "closed" ? (
            <p className="muted">{m.closed}</p>
          ) : (
            <form className="settings-panel" onSubmit={create}>
              {state.signup === "claim" && (
                <>
                  <p className="muted">{m.claimIntro}</p>
                  <label>
                    {m.claimCode}
                    <input
                      value={claimCode}
                      placeholder="XXXX-XXXX-XXXX"
                      spellCheck={false}
                      autoCapitalize="characters"
                      autoComplete="off"
                      onChange={(e) => {
                        setClaimCode(e.target.value);
                        setError(null);
                      }}
                    />
                  </label>
                </>
              )}
              {error && <p className="warn">{error}</p>}
              <div className="form-actions">
                <button type="submit" disabled={busy}>
                  {busy ? m.creating : m.create}
                </button>
              </div>
            </form>
          )}
        </section>
      </div>
    </main>
  );
}
