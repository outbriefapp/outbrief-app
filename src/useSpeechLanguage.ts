import { useEffect, useState } from "react";
import { type DaemonLink, setDaemonBriefLanguage } from "./daemonLink.ts";
import { ServerError } from "./serverClient.ts";
import {
  resolveSpeechLanguage,
  type SpeechLanguage,
  type SpeechLanguagePref,
  systemSpeechLanguage,
} from "./voice/index.ts";

/** How long to wait before telling a daemon that was not running yet again. */
const DAEMON_RETRY_MS = 30_000;

/** The call language; "system" also follows a change of the system's languages while running. */
export function useSpeechLanguage(pref: SpeechLanguagePref): SpeechLanguage {
  const [system, setSystem] = useState(() => systemSpeechLanguage());
  useEffect(() => {
    if (pref !== "system") return;
    const follow = () => setSystem(systemSpeechLanguage());
    follow();
    window.addEventListener("languagechange", follow);
    return () => window.removeEventListener("languagechange", follow);
  }, [pref]);
  return resolveSpeechLanguage(pref, () => system);
}

/**
 * Tells the outbrief-daemon (on this machine, or the computer a phone picked) which language to
 * write briefs in: on start and whenever it changes, retrying while the daemon is not reachable. A
 * refusal (e.g. another end-to-end key) is not retried: it takes new settings, which run this again.
 */
export function useDaemonBriefLanguage(daemon: DaemonLink | null, language: SpeechLanguage): void {
  useEffect(() => {
    if (!daemon) return;
    const ctrl = new AbortController();
    let timer: number | undefined;
    const push = () => {
      setDaemonBriefLanguage(daemon, language, ctrl.signal).catch((err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn("[outbrief] daemon brief language", err);
        if (err instanceof ServerError && err.status === null) {
          timer = window.setTimeout(push, DAEMON_RETRY_MS);
        }
      });
    };
    push();
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [daemon, language]);
}
