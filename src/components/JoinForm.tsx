import { ScanLine } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { type AccountPatch, accountErrorText, joinWithInvite } from "../account.ts";
import { MIN_PASSPHRASE_CHARS } from "../e2e/crypto.ts";
import { useT } from "../i18n/index.ts";
import { parsePairingInput } from "../pairing.ts";
import { canScan, QrScanner } from "./QrScanner.tsx";

/**
 * Joins an existing account: scan the QR code of 添加设备 (server address, code and end-to-end key
 * in one), paste its link, or type the 6 digits. Bare digits carry no key, so they ask for the
 * passphrase set on the computer too.
 */
export function JoinForm(props: {
  /** Where bare digits are redeemed; a link names its own server. */
  serverUrl: string;
  currentKey: string;
  onJoined: (patch: AccountPatch) => Promise<void> | void;
  submitLabel?: string;
}) {
  const msg = useT();
  const [input, setInput] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [scanning, setScanning] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const invite = parsePairingInput(input);
  const bareCode = !!invite && !invite.key;

  useEffect(() => {
    let cancelled = false;
    canScan().then((ok) => !cancelled && setCamera(ok));
    return () => {
      cancelled = true;
    };
  }, []);

  const { serverUrl, currentKey, onJoined } = props;
  const join = useCallback(
    async (text: string, phrase: string) => {
      const parsed = parsePairingInput(text);
      if (!parsed) {
        setError(msg.account.inviteInvalid);
        return;
      }
      if (!parsed.key && phrase && [...phrase.normalize("NFC")].length < MIN_PASSPHRASE_CHARS) {
        setError(msg.e2e.tooShort(MIN_PASSPHRASE_CHARS));
        return;
      }
      setBusy(true);
      setError(null);
      try {
        await onJoined(await joinWithInvite(serverUrl, parsed, phrase, currentKey));
      } catch (err) {
        setError(accountErrorText(err));
      } finally {
        setBusy(false);
      }
    },
    [serverUrl, currentKey, onJoined, msg],
  );

  const scanned = useCallback(
    (text: string) => {
      setScanning(false);
      setInput(text);
      // A scanned link has everything; join at once.
      if (parsePairingInput(text)?.key) void join(text, "");
    },
    [join],
  );

  function submit(e: FormEvent) {
    e.preventDefault();
    void join(input, bareCode ? passphrase : "");
  }

  return (
    <form className="settings-panel" onSubmit={submit}>
      {scanning ? (
        <QrScanner onResult={scanned} onClose={() => setScanning(false)} />
      ) : (
        camera && (
          <button type="button" className="scan-button" onClick={() => setScanning(true)}>
            <ScanLine size={18} aria-hidden /> {msg.account.scan}
          </button>
        )
      )}
      <label>
        {msg.account.invite}
        <input
          value={input}
          placeholder={msg.account.invitePlaceholder}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
        />
      </label>
      {bareCode && (
        <label>
          {msg.account.passphrase}
          <input
            type="password"
            value={passphrase}
            autoComplete="off"
            onChange={(e) => setPassphrase(e.target.value)}
          />
          <span className="muted">{msg.account.passphraseHint(MIN_PASSPHRASE_CHARS)}</span>
        </label>
      )}
      {error && <p className="warn">{error}</p>}
      <div className="form-actions">
        <button type="submit" disabled={busy || !invite}>
          {busy ? msg.account.joining : (props.submitLabel ?? msg.account.join)}
        </button>
      </div>
    </form>
  );
}
