import { type Dispatch, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type { E2eKey } from "../e2e/crypto.ts";
import { errorMessage } from "../format.ts";
import { answerQuestion, type LlmSettings } from "../llm/qa.ts";
import type { AgentEvent } from "../protocol.ts";
import type { ServerSettings } from "../serverClient.ts";
import {
  SentenceChunker,
  type SpeechLanguage,
  type SpeechSynth,
  splitSentences,
  type VoiceOptions,
  VoiceUnavailableError,
} from "../voice/index.ts";
import { AnswerSpeech, isAbortError, readingTimeMs, SentencePlayer } from "./player.ts";
import {
  type CallSession,
  createSession,
  currentSentence,
  type SessionAction,
  sessionReducer,
  upcomingSentences,
} from "./session.ts";

export interface CallContext {
  server: ServerSettings;
  /** End-to-end key: replies are sealed with it before they reach the server. */
  e2eKey: E2eKey;
  synth: SpeechSynth;
  /** The call language (设置 → 语音 → 汇报语言); `voice` speaks it. */
  language: SpeechLanguage;
  voice: VoiceOptions;
  /** The user's own endpoint; Q&A runs on this device (设置 → 大模型). */
  llm: LlmSettings;
  /** What the assistant calls the user (设置 → 称呼). */
  addressName: string;
}

export interface CallControls {
  state: CallSession;
  dispatch: Dispatch<SessionAction>;
  /** The sentence being spoken (or, without audio, shown) right now. */
  subtitle: string;
}

/**
 * Runs one call: the session reducer plus every side effect it implies — sentence playback and
 * streamed Q&A answers (spoken as they arrive). Effects follow the session mode, so leaving a mode
 * cancels its audio / requests.
 */
export function useCall(event: AgentEvent, ctx: CallContext): CallControls {
  const [state, dispatch] = useReducer(sessionReducer, event, (e) =>
    createSession(e, splitSentences, ctx.language),
  );
  const player = useMemo(() => new SentencePlayer(ctx.synth), [ctx.synth]);
  const [answerSubtitle, setAnswerSubtitle] = useState("");
  // Effects start from the latest state / settings without restarting when unrelated fields change.
  const stateRef = useRef(state);
  const ctxRef = useRef(ctx);
  useEffect(() => {
    stateRef.current = state;
    ctxRef.current = ctx;
  });

  useEffect(() => () => player.stop(), [player]);

  const { mode, segment, sentence, voice } = state;

  const playing = mode === "playing";
  useEffect(() => {
    if (!playing) return;
    const s = stateRef.current;
    const text = s.segments[segment]?.sentences[sentence];
    if (!text) return;
    const { voice: opts } = ctxRef.current;
    const ended = () => dispatch({ type: "sentenceEnded", segment, sentence });
    let timer: number | undefined;
    const ctrl = new AbortController();
    if (voice === "text") timer = window.setTimeout(ended, readingTimeMs(text, opts.rate));
    else {
      player.play(text, upcomingSentences(s, 2), opts, ctrl.signal).then(ended, (err: unknown) => {
        if (ctrl.signal.aborted || isAbortError(err)) return;
        if (err instanceof VoiceUnavailableError) {
          dispatch({ type: "voiceUnavailable" });
          return;
        }
        // One sentence that cannot be played is shown for its reading time instead.
        console.warn("[outbrief] sentence playback", err);
        timer = window.setTimeout(ended, readingTimeMs(text, opts.rate));
      });
    }
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [playing, segment, sentence, voice, player]);

  const answerId = mode === "answering" ? state.answer?.id : undefined;
  useEffect(() => {
    const s = stateRef.current;
    const answer = s.answer;
    if (answerId === undefined || !answer) return;
    const { llm, voice: opts, addressName, language } = ctxRef.current;
    const ctrl = new AbortController();
    const speech =
      s.voice === "audio" ? new AnswerSpeech(player, opts, ctrl.signal, setAnswerSubtitle) : null;
    const chunker = new SentenceChunker();
    void (async () => {
      try {
        const input = {
          addressName,
          language,
          report: s.report,
          playedSegmentIndex: s.segment,
          history: answer.history,
          question: answer.question,
        };
        for await (const text of answerQuestion(llm, input, ctrl.signal)) {
          dispatch({ type: "answerChunk", id: answerId, text });
          speech?.push(chunker.push(text));
        }
        speech?.push(chunker.flush());
        speech?.end();
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.warn("[outbrief] qa", err);
        dispatch({ type: "answerFailed", id: answerId, message: errorMessage(err) });
        return;
      }
      try {
        await speech?.done;
      } catch (err) {
        if (ctrl.signal.aborted) return;
        if (err instanceof VoiceUnavailableError) dispatch({ type: "voiceUnavailable" });
        else console.warn("[outbrief] answer speech", err);
      }
      dispatch({ type: "answerDone", id: answerId });
    })();
    return () => {
      ctrl.abort();
      setAnswerSubtitle("");
    };
  }, [answerId, player]);

  let subtitle = "";
  if (mode === "answering") subtitle = answerSubtitle;
  else if (mode !== "ended" && !state.playedToEnd) subtitle = currentSentence(state);

  return { state, dispatch, subtitle };
}
