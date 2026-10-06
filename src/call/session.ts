import { t } from "../i18n/index.ts";
import type { AgentEvent, AgentSource, Brief, BriefCard, BriefDecision } from "../protocol.ts";
import {
  CONTINUE_COMMANDS as CONTINUE_WORDS,
  degradedSpeech,
  type SpeechLanguage,
} from "../voice/languages.ts";

/** Bounds on what a question sends to the LLM and what a reply carries. */
export const QA_HISTORY_MAX = 60;
export const TRANSCRIPT_MAX = 200;
export const DECISIONS_MAX = 30;
export const QUESTION_MAX = 4_000;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

/** A decision the user settled during the call (card click or spoken). */
export interface DecisionChoice {
  decisionId: string;
  question: string;
  /** Chosen option label, or the user's own words. */
  choice: string;
}

/** The report a call is about; Q&A sends all of it to the LLM. */
export interface ReportContext {
  source: AgentSource;
  title?: string;
  cwd?: string;
  content: string;
  brief: Brief | null;
}

/** One card of the call with its speech pre-split into TTS sentences. */
export interface PlaybackSegment {
  id: string;
  sentences: string[];
  card: BriefCard;
  /** Raw report shown in place of bullets when the brief is missing. */
  body: string | null;
}

/**
 * playing -> speaking the brief; paused -> silent, resume restarts the current sentence;
 * listening -> push-to-talk recording; transcribing -> speech-to-text running; answering -> the Q&A
 * answer streams and is spoken; ended -> hung up, the reply panel owns the screen. When every
 * segment has played the call stays paused.
 */
export type CallMode = "playing" | "paused" | "listening" | "transcribing" | "answering" | "ended";

export interface PendingAnswer {
  /** Unique per request so chunks of an aborted request are dropped. */
  id: number;
  question: string;
  /** Turns before `question`, as sent to the LLM. */
  history: ChatTurn[];
  text: string;
  /** Why the answer failed (shown with 重试); the partial text stays visible. Null while fine. */
  error: string | null;
}

export interface CallSession {
  report: ReportContext;
  segments: PlaybackSegment[];
  decisions: BriefDecision[];
  /** Index of the segment on screen / being spoken, and of the sentence within it. */
  segment: number;
  sentence: number;
  /** Every segment has played; resuming stays paused instead of replaying. */
  playedToEnd: boolean;
  mode: CallMode;
  /** "text" once TTS is unavailable: cards + subtitles, advanced by a reading timer. */
  voice: "audio" | "text";
  transcript: ChatTurn[];
  /** At most one choice per decision; the latest click / answer wins. */
  choices: DecisionChoice[];
  draft: string;
  answer: PendingAnswer | null;
  /** Transient hint near the input (microphone / transcription problems). */
  notice: string | null;
  /** Last request id handed out (answers). */
  seq: number;
}

export type SessionAction =
  | { type: "interrupt" }
  | { type: "resume" }
  | { type: "jump"; segment: number }
  | { type: "sentenceEnded"; segment: number; sentence: number }
  | { type: "voiceUnavailable" }
  | { type: "listenStart" }
  | { type: "listenEnd" }
  | { type: "listenFailed"; message: string }
  | { type: "transcribed"; text: string }
  | { type: "draftChanged"; text: string }
  | { type: "send" }
  | { type: "answerChunk"; id: number; text: string }
  | { type: "answerDone"; id: number }
  | { type: "answerFailed"; id: number; message: string }
  | { type: "retryAnswer" }
  | { type: "decide"; decisionId: string; choice: string }
  | { type: "hangUp" };

/** Utterances (after `bare`) that resume playback without asking the LLM, in any call language. */
const CONTINUE_COMMANDS = new Set(CONTINUE_WORDS);

/** Strips whitespace, punctuation and case so "继续。" or "Go on!" still match. */
function bare(text: string): string {
  return text.replace(/[\s\p{P}]/gu, "").toLowerCase();
}

/** The report the call is about, as Q&A sends it to the LLM. */
export function reportContext(event: AgentEvent): ReportContext {
  return {
    source: event.source,
    title: event.title,
    cwd: event.cwd,
    content: event.content,
    brief: event.brief?.brief ?? null,
  };
}

/**
 * Starts a call on `event`. Without a ready brief the call degrades to one segment that says so (in
 * the call `language`) and shows the raw report. `split` cuts speech into TTS sentences
 * (`splitSentences` in the app).
 */
export function createSession(
  event: AgentEvent,
  split: (text: string) => string[],
  language: SpeechLanguage,
): CallSession {
  const report = reportContext(event);
  const segments: PlaybackSegment[] = report.brief?.segments.length
    ? report.brief.segments.map((s) => {
        const sentences = split(s.speech);
        return {
          id: s.id,
          sentences: sentences.length ? sentences : [s.speech],
          card: s.card,
          body: null,
        };
      })
    : [
        {
          id: "raw",
          sentences: [degradedSpeech(language)],
          card: { title: event.title ?? t().call.rawReport, bullets: [] },
          body: event.content,
        },
      ];
  return {
    report,
    segments,
    decisions: report.brief?.decisions ?? [],
    segment: 0,
    sentence: 0,
    playedToEnd: false,
    mode: "playing",
    voice: "audio",
    transcript: [],
    choices: [],
    draft: "",
    answer: null,
    notice: null,
    seq: 0,
  };
}

/** The sentence at the playback position. */
export function currentSentence(s: CallSession): string {
  return s.segments[s.segment]?.sentences[s.sentence] ?? "";
}

/** Up to `count` sentences after the playback position, crossing into later segments (prefetch). */
export function upcomingSentences(s: CallSession, count: number): string[] {
  const rest = [
    ...(s.segments[s.segment]?.sentences.slice(s.sentence + 1) ?? []),
    ...s.segments.slice(s.segment + 1).flatMap((seg) => seg.sentences),
  ];
  return rest.slice(0, count);
}

/**
 * Silences whatever is speaking: playback pauses at the current sentence, and a streaming answer is
 * cut off with the part received so far kept in the transcript. Other modes are left alone.
 */
function halt(s: CallSession): CallSession {
  switch (s.mode) {
    case "playing":
      return { ...s, mode: "paused" };
    case "answering": {
      const said = s.answer?.text.trim() ?? "";
      return {
        ...s,
        mode: "paused",
        answer: null,
        transcript: said ? [...s.transcript, { role: "assistant", text: said }] : s.transcript,
      };
    }
    default:
      return s;
  }
}

/** Continues the brief where it stopped (start of the current sentence). Nothing replays after the end. */
function resume(s: CallSession): CallSession {
  return {
    ...s,
    mode: s.playedToEnd ? "paused" : "playing",
    answer: null,
    notice: null,
  };
}

function hangUp(s: CallSession): CallSession {
  return { ...halt(s), mode: "ended", draft: "", notice: null };
}

function ask(s: CallSession, question: string): CallSession {
  const seq = s.seq + 1;
  return {
    ...s,
    seq,
    mode: "answering",
    draft: "",
    notice: null,
    answer: {
      id: seq,
      question,
      history: s.transcript.slice(-QA_HISTORY_MAX),
      text: "",
      error: null,
    },
    transcript: [...s.transcript, { role: "user", text: question }],
  };
}

export function sessionReducer(s: CallSession, action: SessionAction): CallSession {
  switch (action.type) {
    case "interrupt":
      return halt(s);
    case "resume":
      return s.mode === "paused" ? resume(s) : s;
    case "jump": {
      if (s.mode === "ended" || !s.segments[action.segment]) return s;
      const moved = { ...s, segment: action.segment, sentence: 0, playedToEnd: false };
      if (s.mode === "playing") return { ...moved, mode: "playing" };
      return halt(moved);
    }
    case "sentenceEnded": {
      if (s.mode !== "playing" || action.segment !== s.segment || action.sentence !== s.sentence)
        return s;
      if (s.sentence + 1 < (s.segments[s.segment]?.sentences.length ?? 0))
        return { ...s, sentence: s.sentence + 1 };
      if (s.segment + 1 < s.segments.length) return { ...s, segment: s.segment + 1, sentence: 0 };
      return { ...s, playedToEnd: true, mode: "paused" };
    }
    case "voiceUnavailable":
      return { ...s, voice: "text" };
    case "listenStart":
      return s.mode === "ended" ? s : { ...halt(s), mode: "listening", notice: null };
    case "listenEnd":
      return s.mode === "listening" ? { ...s, mode: "transcribing" } : s;
    case "listenFailed":
      return s.mode === "listening" || s.mode === "transcribing"
        ? { ...s, mode: "paused", notice: action.message }
        : s;
    case "transcribed": {
      if (s.mode !== "transcribing") return s;
      const text = action.text.trim();
      return text
        ? { ...s, mode: "paused", draft: text }
        : { ...s, mode: "paused", notice: t().call.notHeard };
    }
    case "draftChanged":
      return s.mode === "ended" ? s : { ...halt(s), draft: action.text };
    case "send": {
      const text = s.draft.trim().slice(0, QUESTION_MAX);
      const idle = halt(s);
      if (!text || idle.mode !== "paused") return s;
      if (CONTINUE_COMMANDS.has(bare(text))) return { ...resume(idle), draft: "" };
      return ask(idle, text);
    }
    case "answerChunk":
      return s.mode === "answering" && s.answer?.id === action.id
        ? { ...s, answer: { ...s.answer, text: s.answer.text + action.text } }
        : s;
    case "answerDone": {
      if (s.mode !== "answering" || s.answer?.id !== action.id) return s;
      const said = s.answer.text.trim();
      return {
        ...s,
        mode: "paused",
        answer: null,
        transcript: said ? [...s.transcript, { role: "assistant", text: said }] : s.transcript,
      };
    }
    case "answerFailed":
      return s.mode === "answering" && s.answer?.id === action.id
        ? { ...s, mode: "paused", answer: { ...s.answer, error: action.message } }
        : s;
    case "retryAnswer": {
      if (s.mode !== "paused" || !s.answer || s.answer.error === null) return s;
      const seq = s.seq + 1;
      return {
        ...s,
        seq,
        mode: "answering",
        answer: { ...s.answer, id: seq, text: "", error: null },
      };
    }
    case "decide": {
      const decision = s.decisions.find((d) => d.id === action.decisionId);
      if (!decision || s.mode === "ended") return s;
      const halted = halt(s);
      return {
        ...halted,
        choices: [
          ...halted.choices.filter((c) => c.decisionId !== decision.id),
          { decisionId: decision.id, question: decision.question, choice: action.choice },
        ],
        transcript: [
          ...halted.transcript,
          { role: "user", text: `选择:${decision.question} -> ${action.choice}` },
        ],
      };
    }
    case "hangUp":
      return s.mode === "ended" ? s : hangUp(s);
  }
}
