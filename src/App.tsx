import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { type AccountPatch, useAccountBootstrap } from "./account.ts";
import { personalizeEvent } from "./addressName.ts";
import { requestCallAttention } from "./attention.ts";
import { arrivalOf, markAnswered, wasAnswered } from "./call/answered.ts";
import { prepareSpeech } from "./call/prepare.ts";
import { endedCall, loadCallRecord, saveCallRecord, updateCallRecord } from "./call/records.ts";
import type { CallContext } from "./call/useCall.ts";
import { isRingAllowed, switchOn } from "./callModes.ts";
import { callReducer, initialCallState, missedCalls, reportsToPrepare } from "./callQueue.ts";
import { ActiveCall, type CallResult } from "./components/ActiveCall.tsx";
import { DispatchScreen } from "./components/DispatchScreen.tsx";
import { HistoryScreen } from "./components/HistoryScreen.tsx";
import { IdleScreen } from "./components/IdleScreen.tsx";
import { IncomingCall } from "./components/IncomingCall.tsx";
import { SettingsForm, type SettingsPatch } from "./components/SettingsForm.tsx";
import { WelcomeScreen } from "./components/WelcomeScreen.tsx";
import { applyUpdate, openEvent, openUpdate } from "./e2e/events.ts";
import { useE2eKey } from "./e2e/useE2eKey.ts";
import { errorMessage } from "./format.ts";
import { resolveLocale, setLocale, systemLocale, useT } from "./i18n/index.ts";
import type { AgentEvent, CallOutcome, RelayedEvent } from "./protocol.ts";
import {
  type ConnectionStatus,
  followEventStream,
  reportOutcome,
  type ServerSettings,
} from "./serverClient.ts";
import {
  type AppSettings,
  activeModes,
  loadEnvDefaults,
  loadSettings,
  saveSettings,
  serverOf,
} from "./settings.ts";
import { localizeShell } from "./shell.ts";
import { useDaemonLink, useLocalDaemonKey } from "./useDaemon.ts";
import { useRingSchedule } from "./useRingSchedule.ts";
import { useRingtone } from "./useRingtone.ts";
import { useDaemonBriefLanguage, useSpeechLanguage } from "./useSpeechLanguage.ts";
import { createSpeechSynth } from "./voice/index.ts";
import { voiceOptions } from "./voice/tts/settings.ts";

/** No account: what `leave` saves (the device keeps its other settings). */
const NO_ACCOUNT: Pick<AppSettings, "token" | "accountId" | "deviceId" | "daemonId"> = {
  token: "",
  accountId: "",
  deviceId: "",
  daemonId: null,
};

const CLAIM_CODE = loadEnvDefaults().claimCode;

/** `modes`: the settings opened on 设置 → 模式. */
type View = "idle" | "settings" | "modes" | "history" | "dispatch";

/** A relayed call this device could not open (wrong key, tampered). It never rings. */
export interface UnreadableCall {
  relayed: RelayedEvent;
  message: string;
}

/**
 * Saves a call that just ended to this device's history. Storage errors are logged: the call
 * itself already ended.
 */
function remember(event: AgentEvent, outcome: CallOutcome, result?: CallResult): void {
  const reply = result?.reply;
  try {
    saveCallRecord(
      endedCall(reply ? applyUpdate(event, reply.updated) : event, outcome, {
        transcript: result?.transcript,
        decisions: result?.decisions,
        reply: reply?.content ?? null,
      }),
    );
  } catch (err) {
    console.warn("[outbrief] save history", err);
  }
}

export function App() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [view, setView] = useState<View>("idle");
  const [status, setStatus] = useState<ConnectionStatus>("offline");
  // This device was removed from its account during this session: it must not make a new one silently.
  const [removed, setRemoved] = useState(false);
  const update = useCallback((patch: Partial<AppSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      saveSettings(next);
      return next;
    });
  }, []);
  const joined = useCallback(
    (patch: AccountPatch) => {
      update({ ...patch, daemonId: null });
      setRemoved(false);
      setView("idle");
    },
    [update],
  );
  const leave = useCallback(() => {
    update(NO_ACCOUNT);
    setRemoved(true);
    setView("idle");
  }, [update]);
  // The daemon on this machine, if any (desktop): the account to join, and the key to follow.
  const localKey = useLocalDaemonKey();
  const bootstrap = useAccountBootstrap({
    settings,
    localKey,
    claimCode: CLAIM_CODE,
    removed,
    onJoined: joined,
  });
  // 设置 → 语言; "system" also follows a change of the system's language while running.
  const { language } = settings;
  useEffect(() => {
    setLocale(resolveLocale(language));
    if (language !== "system") return;
    const follow = () => setLocale(systemLocale());
    window.addEventListener("languagechange", follow);
    return () => window.removeEventListener("languagechange", follow);
  }, [language]);
  const msg = useT();
  useEffect(() => {
    localizeShell(msg).catch((err: unknown) => console.warn("[outbrief] localize shell", err));
  }, [msg]);
  // Outside the active mode's ringing time calls do not ring: they are missed calls.
  const onModes = useMemo(() => activeModes(settings), [settings]);
  const onModesRef = useRef(onModes);
  useEffect(() => {
    onModesRef.current = onModes;
  });
  const schedule = useRingSchedule(onModes);
  const [state, dispatch] = useReducer(callReducer, schedule.allowed, (allowed) => ({
    ...initialCallState,
    ringAllowed: allowed,
  }));
  useEffect(() => {
    dispatch({ type: "ringAllowedChanged", allowed: schedule.allowed });
  }, [schedule.allowed]);

  // Voice / LLM changes must not reconnect the stream or reset the synthesizer's cache.
  const connection = serverOf(settings);
  const serverUrl = connection?.serverUrl;
  const token = connection?.token;
  const server = useMemo<ServerSettings | null>(
    () => (serverUrl && token ? { serverUrl, token } : null),
    [serverUrl, token],
  );
  const synth = useMemo(() => createSpeechSynth(), []);
  // Follows the local daemon's key unless one was set by hand; remembered for daemon restarts.
  const rememberDaemonKey = useCallback((key: string) => update({ e2eKey: key }), [update]);
  const keyState = useE2eKey(settings, localKey, rememberDaemonKey);
  const e2eKey = keyState.phase === "ready" ? keyState.key : null;
  // Daemon settings (Multica, brief LLM, language): this machine's daemon, or a computer of the
  // account through the server.
  const { link: daemon, daemons } = useDaemonLink({
    localKey,
    server,
    e2eKey,
    daemonId: settings.daemonId,
  });
  // The server no longer knows this device's token: it was removed on another device.
  useEffect(() => {
    if (status === "unauthorized") leave();
  }, [status, leave]);
  const [unreadable, setUnreadable] = useState<UnreadableCall[]>([]);
  // 设置 → 语音 → 汇报语言: briefs are written in it (by the local daemon), and spoken with a voice
  // of that language.
  const speechLanguage = useSpeechLanguage(settings.speechLanguage);
  useDaemonBriefLanguage(daemon, speechLanguage);
  const { rate, llm, addressName, tts } = settings;
  const voice = useMemo(() => voiceOptions(tts, rate, speechLanguage), [tts, rate, speechLanguage]);
  const ctx = useMemo<CallContext | null>(
    () =>
      server && e2eKey
        ? {
            server,
            e2eKey,
            synth,
            language: speechLanguage,
            voice,
            llm,
            addressName,
          }
        : null,
    [server, e2eKey, synth, speechLanguage, voice, llm, addressName],
  );
  // The stream must not reconnect when the 称呼 changes; new calls pick up the latest one.
  const addressNameRef = useRef(addressName);
  useEffect(() => {
    addressNameRef.current = addressName;
  });

  // Calls arrive sealed and are opened here, in arrival order. A new key reconnects: the replay of
  // pending calls opens the ones the old key could not (calls already opened never ring twice).
  useEffect(() => {
    if (!server || !e2eKey) return;
    setUnreadable([]);
    const ctrl = new AbortController();
    let opening = Promise.resolve();
    const inOrder = (task: () => Promise<void>) => {
      opening = opening.then(task).catch((err: unknown) => console.warn("[outbrief] open", err));
    };
    void followEventStream(
      server,
      {
        onEvent: (relayed) =>
          inOrder(async () => {
            try {
              const event = await openEvent(e2eKey, relayed);
              if (ctrl.signal.aborted) return;
              // A call rings once per device, even after a restart or reload (YOUT-226).
              const arrival = arrivalOf({
                recorded: loadCallRecord(event.id)?.event.status ?? null,
                answeredHere: wasAnswered(event.id),
                // Received in the quiet time (e.g. overnight while this app was closed): missed.
                ringAllowed: isRingAllowed(onModesRef.current, new Date(event.receivedAt)),
              });
              if (arrival.kind === "ended") {
                reportOutcome(server, event.id, arrival.outcome).catch((err) =>
                  console.warn("[outbrief] outcome", err),
                );
                return;
              }
              dispatch({
                type: "arrived",
                event: personalizeEvent(event, addressNameRef.current),
                missed: arrival.kind === "missed",
              });
            } catch (err) {
              if (ctrl.signal.aborted) return;
              const message = errorMessage(err);
              setUnreadable((prev) =>
                prev.some((u) => u.relayed.id === relayed.id)
                  ? prev
                  : [...prev, { relayed, message }],
              );
            }
          }),
        onStatus: setStatus,
        onEventUpdated: (relayed) =>
          inOrder(async () => {
            const update = await openUpdate(e2eKey, relayed);
            if (ctrl.signal.aborted) return;
            dispatch({ type: "eventUpdated", update });
            try {
              updateCallRecord(update.id, (r) => ({ ...r, event: applyUpdate(r.event, update) }));
            } catch (err) {
              console.warn("[outbrief] update history", err);
            }
          }),
      },
      ctrl.signal,
    );
    return () => ctrl.abort();
  }, [server, e2eKey]);

  // A report rings only once all of its speech is synthesized; each one is prepared once, in queue
  // order (the shared voice concurrency limit serves earlier requests first).
  const voiceRef = useRef(ctx && { voice: ctx.voice, language: ctx.language });
  useEffect(() => {
    voiceRef.current = ctx && { voice: ctx.voice, language: ctx.language };
  });
  // In-flight preparations of the current synthesizer; a new synthesizer starts over.
  const preparations = useRef(new Map<string, AbortController>());
  useEffect(() => {
    if (!synth) return;
    const running = new Map<string, AbortController>();
    preparations.current = running;
    return () => {
      for (const ctrl of running.values()) ctrl.abort();
      running.clear();
    };
  }, [synth]);
  useEffect(() => {
    const speech = voiceRef.current;
    if (!synth || !speech) return;
    for (const event of reportsToPrepare(state)) {
      if (preparations.current.has(event.id)) continue;
      const ctrl = new AbortController();
      preparations.current.set(event.id, ctrl);
      prepareSpeech(event, synth, speech.voice, speech.language, ctrl.signal)
        .then(
          () => dispatch({ type: "prepared", id: event.id }),
          (err: unknown) => {
            if (ctrl.signal.aborted) return;
            console.warn("[outbrief] prepare speech", err);
            dispatch({ type: "prepareFailed", id: event.id, message: errorMessage(err) });
          },
        )
        .finally(() => {
          if (preparations.current.get(event.id) === ctrl) preparations.current.delete(event.id);
        });
    }
  }, [state, synth]);

  const ringingId = state.current?.phase === "ringing" ? state.current.event.id : null;
  useEffect(() => {
    if (ringingId) {
      requestCallAttention().catch((err) => console.warn("[outbrief] attention", err));
    }
  }, [ringingId]);
  useRingtone(ringingId ? settings.ringtones.incoming : null);

  const finish = useCallback(
    (outcome: CallOutcome, result?: CallResult) => {
      const current = state.current;
      if (!current || !server) return;
      remember(current.event, outcome, result);
      dispatch({ type: outcome === "dismissed" ? "decline" : "hangUp" });
      reportOutcome(server, current.event.id, outcome).catch((err) =>
        console.warn("[outbrief] outcome", err),
      );
    },
    [state.current, server],
  );

  const dropFailed = useCallback(
    (id: string) => {
      if (!server) return;
      const dropped = state.failed.find((f) => f.event.id === id);
      if (dropped) remember(dropped.event, "dismissed");
      dispatch({ type: "dropFailed", id });
      reportOutcome(server, id, "dismissed").catch((err) =>
        console.warn("[outbrief] outcome", err),
      );
    },
    [server, state.failed],
  );

  /** 全部知悉: missed calls the user knows about and will not answer. */
  const acknowledge = useCallback(
    (ids: string[]) => {
      if (!server) return;
      const missed = missedCalls(state).filter((e) => ids.includes(e.id));
      for (const event of missed) {
        remember(event, "acknowledged");
        preparations.current.get(event.id)?.abort();
        reportOutcome(server, event.id, "acknowledged").catch((err) =>
          console.warn("[outbrief] outcome", err),
        );
      }
      dispatch({ type: "acknowledge", ids: missed.map((e) => e.id) });
    },
    [server, state],
  );

  const complete = useCallback((result: CallResult) => finish("completed", result), [finish]);

  /** An unreadable call is only dismissed: there is nothing to keep in the history. */
  const dropUnreadable = useCallback(
    (id: string) => {
      setUnreadable((prev) => prev.filter((u) => u.relayed.id !== id));
      if (!server) return;
      reportOutcome(server, id, "dismissed").catch((err) =>
        console.warn("[outbrief] outcome", err),
      );
    },
    [server],
  );

  function save(patch: SettingsPatch) {
    update(patch);
  }

  // No account yet: join the local daemon's / create one by itself, or ask.
  if (!server) {
    if (bootstrap.phase === "welcome") {
      return (
        <WelcomeScreen
          state={bootstrap}
          serverUrl={settings.serverUrl}
          currentKey={settings.e2eKey}
          removed={removed}
          onServerUrl={(serverUrl) => update({ serverUrl })}
          onJoined={joined}
        />
      );
    }
    return (
      <main className="screen center">
        <p className="muted">{msg.account.starting}</p>
      </main>
    );
  }

  // A call always takes the screen; the view underneath comes back once it ends.
  const { current, waiting, failed } = state;
  if (current?.phase === "ringing") {
    return (
      <IncomingCall
        event={current.event}
        waitingCount={waiting.length}
        onAccept={() => {
          markAnswered(current.event.id);
          dispatch({ type: "accept" });
        }}
        onDecline={() => finish("dismissed")}
      />
    );
  }
  if (current?.phase === "active" && ctx) {
    return (
      <ActiveCall
        key={current.event.id}
        event={current.event}
        ctx={ctx}
        waitingCount={waiting.length}
        onComplete={complete}
      />
    );
  }
  if (view === "settings" || view === "modes") {
    return (
      <SettingsForm
        settings={settings}
        initialPage={view === "modes" ? "modes" : undefined}
        e2eReady={e2eKey !== null}
        daemon={daemon}
        daemons={daemons}
        onSave={save}
        onLeft={leave}
        onSwitched={joined}
        onClose={() => setView("idle")}
      />
    );
  }
  const missed = missedCalls(state);
  // Missed calls ready to answer; the rest still prepare their speech.
  const missedReady = missed.filter((e) => state.prepared.has(e.id)).length;
  if (view === "dispatch") {
    return (
      <DispatchScreen
        daemon={daemon}
        daemons={daemons}
        ringtone={settings.ringtones.dispatch}
        onBack={() => setView("idle")}
      />
    );
  }
  if (view === "history") {
    return (
      <HistoryScreen
        ctx={ctx}
        daemon={daemon}
        missed={missed}
        ready={state.prepared}
        onAnswer={(id) => {
          markAnswered(id);
          dispatch({ type: "answer", id });
        }}
        onAcknowledge={acknowledge}
        onBack={() => setView("idle")}
      />
    );
  }
  return (
    <IdleScreen
      status={server ? status : "unconfigured"}
      preparingCount={reportsToPrepare(state).length}
      modes={settings.modes}
      schedule={schedule}
      missedCount={missedReady}
      onSwitchMode={(modeId) => {
        const mode = settings.modes.find((m) => m.id === modeId);
        const today = schedule.mode?.id;
        save({
          activeModeIds: mode
            ? switchOn(settings.modes, settings.activeModeIds, mode)
            : settings.activeModeIds.filter((id) => id !== today),
        });
      }}
      failed={failed}
      unreadable={unreadable}
      keyProblem={keyState.phase === "missing" ? keyState.message : null}
      onRetry={(id) => dispatch({ type: "retryPrepare", id })}
      onDrop={dropFailed}
      onDropUnreadable={dropUnreadable}
      onOpenSettings={() => setView("settings")}
      onManageModes={() => setView("modes")}
      onOpenHistory={() => setView("history")}
      onOpenDispatch={() => setView("dispatch")}
    />
  );
}
