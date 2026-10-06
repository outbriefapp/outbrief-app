import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CallMode, ChatTurn, DecisionChoice } from "../call/session.ts";
import { type CallContext, useCall } from "../call/useCall.ts";
import type { EventUpdate } from "../e2e/events.ts";
import { callerName, callerSubtitle, projectName } from "../format.ts";
import { type Messages, useT } from "../i18n/index.ts";
import { callPanes } from "../layout.ts";
import type { AgentEvent } from "../protocol.ts";
import { useLayoutClass } from "../useLayoutClass.ts";
import { CallCard, DecisionPanel } from "./CallCard.tsx";
import { ChatLog } from "./ChatLog.tsx";
import { RawReport } from "./RawReport.tsx";
import { ReplyPanel } from "./ReplyPanel.tsx";

function useElapsed(): string {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - start) / 1_000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The hint under the card for `mode`, if it has one. */
function hintOf(hints: Messages["call"]["hint"], mode: CallMode): string | undefined {
  return mode in hints ? hints[mode as keyof typeof hints] : undefined;
}

/** Modes in which something is speaking, so the middle button pauses. */
const SPEAKING: Partial<Record<CallMode, true>> = {
  playing: true,
  answering: true,
};

/** What the user did in a call, handed back when it is done. */
export interface CallResult {
  transcript: ChatTurn[];
  decisions: DecisionChoice[];
  /** Set when a reply was sent: its text and the delivery the server queued. */
  reply: { content: string; updated: EventUpdate } | null;
}

/**
 * An accepted call: brief cards + voice, interrupt Q&A, and on hang-up the reply to the agent. In
 * replay (from history) `onExit` is given: hanging up leaves at once and nothing is reported.
 */
export function ActiveCall(props: {
  event: AgentEvent;
  ctx: CallContext;
  waitingCount: number;
  onComplete: (result: CallResult) => void;
  onExit?: () => void;
}) {
  const msg = useT();
  const { event } = props;
  const elapsed = useElapsed();
  const { state, dispatch, subtitle } = useCall(event, props.ctx);
  const { mode } = state;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 摆法按这个组件自己拿到的宽度决定，不读 window.innerWidth（YOUT-215）。折叠 / 展开时宽度变了
  // 就地重排，通话不中断：会话状态在 useCall 里，讲到第几段不受重排影响。
  const screenRef = useRef<HTMLElement>(null);
  const layout = useLayoutClass(screenRef);
  const panes = callPanes(
    layout,
    state.segments.some((s) => s.body !== null),
  );

  // Hand the transcription over to the text box for editing; Enter sends it.
  const prevMode = useRef(mode);
  useEffect(() => {
    if (prevMode.current === "transcribing" && mode === "paused" && state.draft)
      inputRef.current?.focus();
    prevMode.current = mode;
  }, [mode, state.draft]);

  // Grow with the text up to the CSS max-height, then scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure whenever the text changes
  useLayoutEffect(() => {
    const box = inputRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${box.scrollHeight + box.offsetHeight - box.clientHeight}px`;
  }, [state.draft]);

  function send() {
    dispatch({ type: "send" });
  }

  function hangUp() {
    if (props.onExit) props.onExit();
    else dispatch({ type: "hangUp" });
  }

  const project = projectName(event);
  const header = (
    <header className="call-header">
      <div className="caller-line">
        {project && <span className="project-tag">{project}</span>}
        <strong>{callerName(event)}</strong>
        <span className="muted"> · {callerSubtitle(event)}</span>
      </div>
      <span className="timer">{props.onExit ? msg.call.replay : elapsed}</span>
    </header>
  );

  if (mode === "ended") {
    const complete = (reply: CallResult["reply"]) =>
      props.onComplete({ transcript: state.transcript, decisions: state.choices, reply });
    return (
      <main className="screen call active" ref={screenRef}>
        {header}
        <ReplyPanel
          server={props.ctx.server}
          e2eKey={props.ctx.e2eKey}
          event={event}
          transcript={state.transcript}
          decisions={state.choices}
          onSent={(updated, content) => complete({ content, updated })}
          onSkip={() => complete(null)}
        />
        {props.waitingCount > 0 && (
          <p className="queue-badge">{msg.call.nextAfter(props.waitingCount)}</p>
        )}
      </main>
    );
  }

  const busyInput = mode === "listening" || mode === "transcribing";
  const hint =
    state.notice ??
    (state.playedToEnd && mode === "paused" ? msg.call.playedToEnd : hintOf(msg.call.hint, mode));
  // 左栏（窄屏时就是整个界面）：折起时那一整套通话界面原封不动 —— 标题、卡片、聊天、输入框、
  // 暂停 / 挂断。挂断栏留在这里，不横跨两块屏：一边屏幕一个按钮很怪，手也伸不过去。
  const stage = (
    <div className="call-stage">
      {header}
      {state.voice === "text" && <p className="banner">{msg.call.voiceDown}</p>}
      <CallCard
        segments={state.segments}
        index={state.segment}
        onJump={(segment) => dispatch({ type: "jump", segment })}
      />
      <DecisionPanel
        decisions={state.decisions}
        choices={state.choices}
        onChoose={(decisionId, choice) => dispatch({ type: "decide", decisionId, choice })}
      />
      <ChatLog
        turns={state.transcript}
        pending={state.answer}
        onRetry={() => dispatch({ type: "retryAnswer" })}
      />
      {subtitle && <p className="subtitle">{subtitle}</p>}
      {hint && <p className={state.notice ? "hint-line warn" : "hint-line"}>{hint}</p>}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          ref={inputRef}
          rows={3}
          value={state.draft}
          disabled={busyInput}
          placeholder={mode === "transcribing" ? msg.call.hint.transcribing : msg.call.placeholder}
          onChange={(e) => dispatch({ type: "draftChanged", text: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          aria-label={msg.call.ask}
        />
        <button type="submit" className="pill primary" disabled={busyInput || !state.draft.trim()}>
          {msg.call.send}
        </button>
      </form>
      {props.waitingCount > 0 && (
        <p className="queue-badge">{msg.incoming.waiting(props.waitingCount)}</p>
      )}
      <footer className="call-toolbar">
        <button
          type="button"
          className="tool"
          disabled={busyInput}
          onClick={() => dispatch({ type: SPEAKING[mode] ? "interrupt" : "resume" })}
        >
          <span className="tool-icon">{SPEAKING[mode] ? "❚❚" : "▶"}</span>
          {SPEAKING[mode] ? msg.call.pause : msg.call.resume}
        </button>
        <button type="button" className="tool hangup" onClick={hangUp}>
          <span className="tool-icon round decline">✕</span>
          {msg.call.hangUp}
        </button>
      </footer>
    </div>
  );
  // 宽屏下不是「多一个界面」，而是同一个界面变宽：多出来的宽度给汇报原文（右栏），纵向的挤压
  // 因此缓解。窄屏、折叠屏外屏、默认宽度的桌面窗口都走单栏，和现在完全一样。
  return (
    <main className={`screen call active call-wide ${layout}`} ref={screenRef}>
      {stage}
      {panes.raw && <RawReport content={event.content} />}
    </main>
  );
}
