import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { type AccountPatch, useAccountBootstrap } from "./account.ts";
import { personalizeEvent } from "./addressName.ts";
import { requestCallAttention } from "./attention.ts";
import { arrivalOf, isLate, markAnswered, wasAnswered } from "./call/answered.ts";
import { type InboxEntry, SOMEWHERE_ELSE, settleInbox } from "./call/inbox.ts";
import { prepareSpeech } from "./call/prepare.ts";
import { endedCall, loadCallRecord, saveCallRecord, updateCallRecord } from "./call/records.ts";
import type { CallContext } from "./call/useCall.ts";
import { isRingAllowed, switchOn } from "./callModes.ts";
import { callReducer, initialCallState, missedCalls, reportsToPrepare } from "./callQueue.ts";
import {
  isAndroidApp,
  shownStatus,
  takeServiceInbox,
  useCallService,
  useCallServiceStatus,
  usePageVisible,
} from "./callService.ts";
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
import { loadModeHistory, modesAt, rememberModes } from "./modeHistory.ts";
import type { AgentEvent, CallOutcome, EventStatus, HandledBy, RelayedEvent } from "./protocol.ts";
import {
  answerCall,
  type ConnectionStatus,
  followEventStream,
  listPendingEvents,
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

/** Saves a call another device answered or ended to this device's history, saying so. */
function rememberElsewhere(event: AgentEvent, status: EventStatus, handledBy: HandledBy): void {
  try {
    saveCallRecord({ ...endedCall(event, "completed"), event: { ...event, status, handledBy } });
  } catch (err) {
    console.warn("[outbrief] save history", err);
  }
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
  // A call is missed by the modes on when it was received, which a phone often hears of later.
  useEffect(() => {
    rememberModes(onModes, Date.now());
  }, [onModes]);
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

  // Every device of the account rings at once; a call another device answered or ended leaves this
  // one (OUTB-57). `opened` holds the calls this device opened and has not ended itself, for its
  // history.
  const opened = useRef(new Map<string, AgentEvent>());
  const deviceId = settings.deviceId;
  const deviceIdRef = useRef(deviceId);
  useEffect(() => {
    deviceIdRef.current = deviceId;
  });
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const handOffRef = useRef<(id: string, status: EventStatus, handledBy: HandledBy) => void>(
    () => undefined,
  );

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
    let lastSeq = 0;
    // Taken from the Android call service, not yet settled (kept when listing the pending fails).
    let inbox: InboxEntry[] = [];
    // Back online: calls that ended on another device while this one was offline stop too.
    const reconcile = () => {
      const upToSeq = lastSeq;
      // The service's inbox first: a call it heard of is on the pending list unless it ended.
      takeServiceInbox()
        .catch((err: unknown) => {
          console.warn("[outbrief] call service inbox", err);
          return [];
        })
        .then((taken) => {
          inbox = [...inbox, ...taken];
          return listPendingEvents(server);
        })
        .then(
          (events) =>
            inOrder(async () => {
              if (ctrl.signal.aborted) return;
              const pending = new Set(events.map((e) => e.id));
              await settleServiceInbox(pending);
              const { current } = stateRef.current;
              const active = current?.phase === "active" ? current.event.id : null;
              for (const [id, event] of opened.current) {
                if (event.seq <= upToSeq && !pending.has(id) && id !== active) {
                  handOffRef.current(id, "received", SOMEWHERE_ELSE);
                }
              }
              dispatch({ type: "reconciled", pending, upToSeq });
            }),
          (err: unknown) => console.warn("[outbrief] reconcile", err),
        );
    };
    // Calls another device answered while the page was paused go to the history saying where
    // (OUTB-63); the ones it never opened are opened from the ciphertext the service kept.
    const settleServiceInbox = async (pending: ReadonlySet<string>) => {
      const entries = inbox;
      inbox = [];
      const steps = settleInbox(entries, {
        pending,
        deviceId: deviceIdRef.current,
        opened: (id) => opened.current.has(id),
        answeredHere: wasAnswered,
        recorded: (id) => {
          const record = loadCallRecord(id);
          if (!record) return null;
          return record.event.handledBy ? "elsewhere" : "mine";
        },
      });
      for (const step of steps) {
        if (step.kind === "handOff") {
          handOffRef.current(step.id, step.status, step.handledBy);
          continue;
        }
        try {
          const event = await openEvent(e2eKey, step.event);
          if (ctrl.signal.aborted) return;
          opened.current.set(event.id, personalizeEvent(event, addressNameRef.current));
          handOffRef.current(event.id, step.status, step.handledBy);
        } catch (err) {
          console.warn("[outbrief] open call from the service", err);
        }
      }
    };
    // Back on screen the page's stream may not have dropped: settle what the service heard anyway.
    const onVisible = () => {
      if (isAndroidApp() && document.visibilityState === "visible") reconcile();
    };
    document.addEventListener("visibilitychange", onVisible);
    ctrl.signal.addEventListener("abort", () =>
      document.removeEventListener("visibilitychange", onVisible),
    );
    void followEventStream(
      server,
      {
        onEvent: (relayed) =>
          inOrder(async () => {
            lastSeq = Math.max(lastSeq, relayed.seq);
            try {
              const event = await openEvent(e2eKey, relayed);
              if (ctrl.signal.aborted) return;
              // A call rings once per device, even after a restart or reload (YOUT-226).
              const receivedAt = new Date(event.receivedAt);
              const arrival = arrivalOf({
                recorded: loadCallRecord(event.id)?.event.status ?? null,
                answeredHere: wasAnswered(event.id),
                // Received in the quiet time (e.g. overnight while this app was closed or asleep):
                // missed, even when 睡眠 is switched off before this device hears of it (OUTB-58).
                ringAllowed: isRingAllowed(
                  modesAt(loadModeHistory(), receivedAt.getTime()) ?? onModesRef.current,
                  receivedAt,
                ),
                // Heard of long after it came in (an update or restart, the app closed or offline):
                // it was never rung in time, so it is missed rather than ringing now (OUTB-60).
                late: isLate(receivedAt, new Date()),
              });
              if (arrival.kind === "ended") {
                reportOutcome(server, event.id, arrival.outcome).catch((err) =>
                  console.warn("[outbrief] outcome", err),
                );
                return;
              }
              const personal = personalizeEvent(event, addressNameRef.current);
              opened.current.set(event.id, personal);
              dispatch({ type: "arrived", event: personal, missed: arrival.kind === "missed" });
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
        onStatus: (next) => {
          setStatus(next);
          if (next === "online") reconcile();
        },
        onCallStatus: (relayed) =>
          inOrder(async () => {
            const { id, status, handledBy } = relayed;
            if (ctrl.signal.aborted || !handledBy) return;
            const record = loadCallRecord(id);
            // This device's own answer or outcome; one it lost is settled by `answerCall`.
            const mine =
              handledBy.id === deviceIdRef.current ||
              wasAnswered(id) ||
              (record !== null && !record.event.handledBy);
            if (!mine) handOffRef.current(id, status, handledBy);
          }),
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

  /** Another device answered or ended the call `id`: it stops here and the history says where. */
  const handOff = useCallback((id: string, status: EventStatus, handledBy: HandledBy) => {
    preparations.current.get(id)?.abort();
    dispatch({ type: "endedElsewhere", ids: [id] });
    setUnreadable((prev) => prev.filter((u) => u.relayed.id !== id));
    const event = opened.current.get(id);
    opened.current.delete(id);
    if (event) rememberElsewhere(event, status, handledBy);
    else {
      // It already went to the history as answered elsewhere; now it ended there too.
      try {
        updateCallRecord(id, (r) =>
          r.event.handledBy
            ? {
                ...r,
                event: {
                  ...r.event,
                  status,
                  handledBy: handledBy.name ? handledBy : r.event.handledBy,
                },
              }
            : r,
        );
      } catch (err) {
        console.warn("[outbrief] update history", err);
      }
    }
  }, []);
  useEffect(() => {
    handOffRef.current = handOff;
  });

  /**
   * Takes the call on this device. It is answered at once; if another device was first, it ends
   * here and the history says where it was answered.
   */
  const claim = useCallback(
    (id: string) => {
      if (!server) return;
      answerCall(server, id).then(
        (result) => {
          if (!result.answered && result.event.handledBy) {
            handOff(id, result.event.status, result.event.handledBy);
          }
        },
        (err: unknown) => console.warn("[outbrief] answer", err),
      );
    },
    [server, handOff],
  );

  // Android: the background call service rings while the page is not on screen (OUTB-60).
  const backgroundCalls = isAndroidApp() && settings.backgroundCalls;
  useCallService({
    enabled: backgroundCalls,
    server,
    e2eKey,
    modes: onModes,
    ringtoneId: settings.ringtones.incoming,
  });
  const callService = useCallServiceStatus(server !== null && backgroundCalls);
  // Whether the service's stream is open, while the page's own one is not.
  const refreshCallService = callService.refresh;
  useEffect(() => {
    if (backgroundCalls && status !== "online") refreshCallService();
  }, [backgroundCalls, status, refreshCallService]);
  const visible = usePageVisible();

  const ringingId = state.current?.phase === "ringing" ? state.current.event.id : null;
  useEffect(() => {
    if (ringingId) {
      requestCallAttention().catch((err) => console.warn("[outbrief] attention", err));
    }
  }, [ringingId]);
  // The service rings a paused page's calls itself; the page's own tone would play on top of it.
  useRingtone(ringingId && (visible || !backgroundCalls) ? settings.ringtones.incoming : null);

  const finish = useCallback(
    (outcome: CallOutcome, result?: CallResult) => {
      const current = state.current;
      if (!current || !server) return;
      opened.current.delete(current.event.id);
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
      opened.current.delete(id);
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
        opened.current.delete(event.id);
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
          claim(current.event.id);
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
        callService={callService}
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
          claim(id);
        }}
        onAcknowledge={acknowledge}
        onBack={() => setView("idle")}
      />
    );
  }
  return (
    <IdleScreen
      status={
        server ? shownStatus(status, backgroundCalls ? callService.status : null) : "unconfigured"
      }
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
      notificationsOff={
        backgroundCalls && !!callService.status && callService.status.notifications !== "granted"
      }
      onTurnOnNotifications={callService.request}
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
