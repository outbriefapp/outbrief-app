import { useEffect, useState } from "react";
import { type DaemonLink, fetchLocalPairing } from "./daemonLink.ts";
import { formatKey, importKey, keyFromPassphrase, randomKeyText } from "./e2e/crypto.ts";
import { t } from "./i18n/index.ts";
import { deviceName, type PairingInvite } from "./pairing.ts";
import type { DeviceSession, SignupMode } from "./protocol.ts";
import {
  createAccount,
  fetchSignupMode,
  type NewDevice,
  redeemPairingCode,
  ServerError,
} from "./serverClient.ts";
import type { AppSettings } from "./settings.ts";

/**
 * Accounts on this device (outbrief-server ADR 0008): there is no login. The first device creates
 * an anonymous account; the others join it with a pairing code. What joining or creating saves.
 */
export type AccountPatch = Pick<
  AppSettings,
  "serverUrl" | "token" | "accountId" | "deviceId" | "e2eKey" | "e2eFromDaemon"
>;

/** This app, as it appears in the account's device list. */
export function thisDevice(): NewDevice {
  return { name: deviceName(), kind: "app" };
}

function patchOf(
  serverUrl: string,
  session: DeviceSession,
  key: Pick<AppSettings, "e2eKey" | "e2eFromDaemon">,
): AccountPatch {
  return {
    serverUrl,
    token: session.token,
    accountId: session.accountId,
    deviceId: session.device.id,
    ...key,
  };
}

/**
 * Joins the account of the outbrief-daemon on this machine: it hands out a pairing code and its
 * end-to-end key through its local API. This is also how a desktop app from before accounts moves
 * off the shared token: it lands in the account its daemon was migrated into.
 */
export async function joinThroughLocalDaemon(
  link: Extract<DaemonLink, { kind: "local" }>,
): Promise<AccountPatch> {
  const pairing = await fetchLocalPairing(link);
  const session = await redeemPairingCode(pairing.serverUrl, pairing.code, thisDevice());
  return patchOf(pairing.serverUrl, session, { e2eKey: pairing.key, e2eFromDaemon: true });
}

/**
 * Creates an account with this app as its first device. It needs an end-to-end key for the devices
 * that join later: the one this device already has, or a new random one.
 */
export async function createOwnAccount(
  serverUrl: string,
  currentKey: string,
  claimCode?: string,
): Promise<AccountPatch> {
  const session = await createAccount(serverUrl, thisDevice(), claimCode);
  return patchOf(serverUrl, session, {
    e2eKey: currentKey || randomKeyText(),
    e2eFromDaemon: false,
  });
}

/**
 * Joins with a scanned / pasted pairing link (server address and key included) or 6 typed digits.
 * Bare digits carry no key: it comes from the passphrase, or stays unset (设置 → 加密 later).
 */
export async function joinWithInvite(
  serverUrl: string,
  invite: PairingInvite,
  passphrase: string,
  currentKey: string,
): Promise<AccountPatch> {
  // Derive before spending the code: a used code cannot be tried again.
  const derived = passphrase
    ? formatKey(await importKey(await keyFromPassphrase(passphrase)))
    : null;
  const server = invite.serverUrl ?? serverUrl;
  const session = await redeemPairingCode(server, invite.code, thisDevice());
  return patchOf(server, session, {
    e2eKey: invite.key ?? derived ?? currentKey,
    e2eFromDaemon: false,
  });
}

/** A server refusal in words (wrong code, signup closed…); other errors keep their message. */
export function accountErrorText(err: unknown): string {
  if (err instanceof ServerError) {
    const known = err.code ? t().account.error[err.code] : undefined;
    if (known) return known;
    if (err.status === null) return t().account.unreachable(err.message);
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * What a device without an account shows. `waitingForDaemon`: a daemon was installed here (its key
 * file exists) but does not answer, so the app waits to join its account instead of creating one.
 */
export type Bootstrap =
  | { phase: "ready" }
  | { phase: "starting" }
  | {
      phase: "welcome";
      signup: SignupMode | null;
      waitingForDaemon: boolean;
      problem: string | null;
    };

const RETRY_MS = 5_000;

/**
 * Gets a device without an account into one, without asking when it can:
 *
 * 1. A daemon on this machine (desktop): join its account.
 * 2. Otherwise, when the server lets anyone sign up (or the build carries the local server's claim
 *    code): create an account.
 * 3. Otherwise (a claimed private server, or this device was just removed): the welcome screen.
 */
export function useAccountBootstrap(options: {
  settings: AppSettings;
  /** undefined while it is being read. */
  localKey: string | null | undefined;
  claimCode: string | undefined;
  /** This device was removed from its account in this session: don't create a new one silently. */
  removed: boolean;
  onJoined: (patch: AccountPatch) => void;
}): Bootstrap {
  const { settings, localKey, claimCode, removed, onJoined } = options;
  const [state, setState] = useState<Bootstrap>({ phase: "starting" });
  const hasAccount = settings.token !== "";
  const { serverUrl, e2eKey } = settings;

  useEffect(() => {
    if (hasAccount) {
      setState({ phase: "ready" });
      return;
    }
    if (localKey === undefined) return;
    let cancelled = false;
    let timer: number | undefined;
    const attempt = async () => {
      if (localKey && !removed) {
        try {
          const patch = await joinThroughLocalDaemon({ kind: "local", localKey });
          if (!cancelled) onJoined(patch);
          return;
        } catch (err) {
          if (cancelled) return;
          console.warn("[outbrief] join through the local daemon", err);
          const daemonDown = err instanceof ServerError && err.status === null;
          // Not running yet, or running but not reaching its server yet: try again.
          const transient = daemonDown || (err instanceof ServerError && (err.status ?? 0) >= 500);
          setState({
            phase: "welcome",
            signup: null,
            waitingForDaemon: daemonDown,
            problem: daemonDown ? null : accountErrorText(err),
          });
          if (transient) timer = window.setTimeout(attempt, RETRY_MS);
          return;
        }
      }
      let signup: SignupMode;
      try {
        signup = await fetchSignupMode(serverUrl);
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: "welcome",
          signup: null,
          waitingForDaemon: false,
          problem: accountErrorText(err),
        });
        timer = window.setTimeout(attempt, RETRY_MS * 2);
        return;
      }
      if (cancelled) return;
      const automatic = !removed && (signup === "open" || (signup === "claim" && !!claimCode));
      if (!automatic) {
        setState({ phase: "welcome", signup, waitingForDaemon: false, problem: null });
        return;
      }
      try {
        const patch = await createOwnAccount(
          serverUrl,
          e2eKey,
          signup === "claim" ? claimCode : undefined,
        );
        if (!cancelled) onJoined(patch);
      } catch (err) {
        if (cancelled) return;
        setState({
          phase: "welcome",
          signup,
          waitingForDaemon: false,
          problem: accountErrorText(err),
        });
      }
    };
    setState({ phase: "starting" });
    void attempt();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [hasAccount, localKey, removed, serverUrl, claimCode, e2eKey, onJoined]);

  return hasAccount ? { phase: "ready" } : state;
}
