import { describe, expect, it } from "vitest";
import type { AgentEvent, Brief } from "../protocol.ts";
import { degradedSpeech } from "../voice/languages.ts";
import {
  type CallSession,
  createSession,
  currentSentence,
  type SessionAction,
  sessionReducer,
  upcomingSentences,
} from "./session.ts";

const brief: Brief = {
  verdict: { status: "done", headline: "登录修好了" },
  facts: [],
  segments: [
    {
      id: "s1",
      speech: "登录修好了|测试全过",
      card: { title: "结论", bullets: ["修好了"] },
      coveredFactIds: [],
    },
    { id: "s2", speech: "还有一个问题", card: { title: "待定", bullets: [] }, coveredFactIds: [] },
  ],
  decisions: [
    {
      id: "d1",
      question: "要不要发版?",
      options: [
        { id: "a", label: "现在发" },
        { id: "b", label: "明天发" },
      ],
      recommendedOptionId: "a",
      reason: null,
    },
  ],
};

function event(
  withBrief: AgentEvent["brief"],
  source: AgentEvent["source"] = "claude-code",
): AgentEvent {
  const at = "2026-09-25T00:00:00.000Z";
  return {
    id: "e1",
    seq: 1,
    source,
    title: "修登录",
    content: "原始汇报全文",
    status: "received",
    occurredAt: at,
    receivedAt: at,
    brief: withBrief,
  };
}

const ready = event({ status: "ready", brief, llmChannel: "primary", generatedAt: "" });
const split = (text: string) => text.split("|");
const run = (s: CallSession, ...actions: SessionAction[]) => actions.reduce(sessionReducer, s);
const start = () => createSession(ready, split, "zh-CN");
const end = (s: CallSession): SessionAction => ({
  type: "sentenceEnded",
  segment: s.segment,
  sentence: s.sentence,
});
/** Plays sentence by sentence until the mode leaves `playing`. */
function playThrough(s: CallSession): CallSession {
  let cur = s;
  while (cur.mode === "playing") cur = sessionReducer(cur, end(cur));
  return cur;
}

describe("createSession", () => {
  it("splits each brief segment into sentences and starts playing the first", () => {
    const s = start();
    expect(s.segments.map((seg) => seg.sentences)).toEqual([
      ["登录修好了", "测试全过"],
      ["还有一个问题"],
    ]);
    expect(s.mode).toBe("playing");
    expect(currentSentence(s)).toBe("登录修好了");
    expect(upcomingSentences(s, 2)).toEqual(["测试全过", "还有一个问题"]);
    expect(s.decisions.map((d) => d.id)).toEqual(["d1"]);
  });

  it("degrades to one segment that says so and shows the raw report when the brief is missing", () => {
    for (const e of [
      event({ status: "failed", brief: null, llmChannel: null, generatedAt: "" }),
      event(null),
    ]) {
      const s = createSession(e, split, "zh-CN");
      expect(s.segments).toEqual([
        {
          id: "raw",
          sentences: [degradedSpeech("zh-CN")],
          card: { title: "修登录", bullets: [] },
          body: "原始汇报全文",
        },
      ]);
      expect(s.decisions).toEqual([]);
      expect(s.report.brief).toBeNull();
    }
  });
});

describe("playback", () => {
  it("advances sentence by sentence, flips to the next segment, then pauses", () => {
    const s0 = start();
    const s1 = sessionReducer(s0, end(s0));
    expect([s1.segment, s1.sentence]).toEqual([0, 1]);
    const s2 = sessionReducer(s1, end(s1));
    expect([s2.segment, s2.sentence]).toEqual([1, 0]);
    const s3 = sessionReducer(s2, end(s2));
    expect(s3.mode).toBe("paused");
    expect(s3.playedToEnd).toBe(true);
    expect(s3.segment).toBe(1);
  });

  it("ignores a sentence end that belongs to an earlier position or arrives while paused", () => {
    const s0 = start();
    const s1 = sessionReducer(s0, end(s0));
    expect(sessionReducer(s1, { type: "sentenceEnded", segment: 0, sentence: 0 })).toBe(s1);
    const paused = sessionReducer(s1, { type: "interrupt" });
    expect(sessionReducer(paused, end(paused))).toBe(paused);
  });

  it("pauses on interrupt and resumes from the start of the same sentence", () => {
    const s = run(
      start(),
      { type: "sentenceEnded", segment: 0, sentence: 0 },
      { type: "interrupt" },
    );
    expect(s.mode).toBe("paused");
    const resumed = sessionReducer(s, { type: "resume" });
    expect(resumed.mode).toBe("playing");
    expect([resumed.segment, resumed.sentence]).toEqual([0, 1]);
  });

  it("jumps to the first sentence of a flipped-to card, keeping playing or paused as it was", () => {
    const playing = run(
      start(),
      { type: "sentenceEnded", segment: 0, sentence: 0 },
      { type: "jump", segment: 1 },
    );
    expect([playing.mode, playing.segment, playing.sentence]).toEqual(["playing", 1, 0]);

    const paused = run(start(), { type: "interrupt" }, { type: "jump", segment: 1 });
    expect([paused.mode, paused.segment, paused.sentence]).toEqual(["paused", 1, 0]);

    const back = run(playThrough(start()), { type: "jump", segment: 0 });
    expect([back.mode, back.segment, back.playedToEnd]).toEqual(["paused", 0, false]);

    expect(sessionReducer(start(), { type: "jump", segment: 5 }).segment).toBe(0);
  });

  it("switches to text mode when the voice is unavailable without losing the position", () => {
    const s = run(
      start(),
      { type: "sentenceEnded", segment: 0, sentence: 0 },
      { type: "voiceUnavailable" },
    );
    expect([s.voice, s.mode, s.sentence]).toEqual(["text", "playing", 1]);
  });
});

describe("interrupt Q&A", () => {
  it("pauses as soon as the user types", () => {
    const s = sessionReducer(start(), { type: "draftChanged", text: "为" });
    expect([s.mode, s.draft]).toEqual(["paused", "为"]);
  });

  it("records, transcribes into the editable draft, and reports silence", () => {
    const listening = sessionReducer(start(), { type: "listenStart" });
    expect(listening.mode).toBe("listening");
    const transcribing = sessionReducer(listening, { type: "listenEnd" });
    expect(transcribing.mode).toBe("transcribing");
    const heard = sessionReducer(transcribing, { type: "transcribed", text: " 为什么改这里 " });
    expect([heard.mode, heard.draft]).toEqual(["paused", "为什么改这里"]);
    const silent = sessionReducer(transcribing, { type: "transcribed", text: "" });
    expect([silent.mode, silent.draft, silent.notice]).toEqual([
      "paused",
      "",
      "没听清，再说一次吧",
    ]);
  });

  it("treats 继续-style commands as resume without asking the LLM", () => {
    for (const text of [
      "继续",
      "继续吧。",
      "接着说",
      " 继续播放！",
      "Go on!",
      "weiter",
      "続けて",
    ]) {
      const s = run(
        start(),
        { type: "sentenceEnded", segment: 0, sentence: 0 },
        { type: "draftChanged", text },
        { type: "send" },
      );
      expect([s.mode, s.sentence, s.draft, s.answer, s.transcript]).toEqual([
        "playing",
        1,
        "",
        null,
        [],
      ]);
    }
  });

  it("asks the question, streams the answer, then waits paused where playback stopped", () => {
    const asked = run(
      start(),
      { type: "sentenceEnded", segment: 0, sentence: 0 },
      { type: "draftChanged", text: "为什么" },
      { type: "send" },
    );
    expect(asked.mode).toBe("answering");
    expect(asked.transcript).toEqual([{ role: "user", text: "为什么" }]);
    expect(asked.answer).toMatchObject({ question: "为什么", history: [], text: "" });
    const id = asked.answer?.id ?? -1;

    const done = run(
      asked,
      { type: "answerChunk", id, text: "因为" },
      { type: "answerChunk", id, text: "旧代码有 bug。" },
      { type: "answerDone", id },
    );
    expect(done.mode).toBe("paused");
    expect(done.answer).toBeNull();
    expect(done.transcript).toEqual([
      { role: "user", text: "为什么" },
      { role: "assistant", text: "因为旧代码有 bug。" },
    ]);
    const resumed = sessionReducer(done, { type: "resume" });
    expect([resumed.mode, resumed.segment, resumed.sentence]).toEqual(["playing", 0, 1]);

    const followUp = run(done, { type: "draftChanged", text: "还有呢" }, { type: "send" });
    expect(followUp.answer?.history).toEqual(done.transcript);
    expect(followUp.answer?.id).not.toBe(id);
  });

  it("cuts an answer off on a new interrupt, keeps what was said, and drops its late chunks", () => {
    const asked = run(start(), { type: "draftChanged", text: "为什么" }, { type: "send" });
    const id = asked.answer?.id ?? -1;
    const cut = run(asked, { type: "answerChunk", id, text: "因为" }, { type: "listenStart" });
    expect([cut.mode, cut.answer]).toEqual(["listening", null]);
    expect(cut.transcript.at(-1)).toEqual({ role: "assistant", text: "因为" });
    expect(sessionReducer(cut, { type: "answerChunk", id, text: "迟到" })).toBe(cut);
  });

  it("keeps a broken answer for retry, re-asking the same question with a fresh request id", () => {
    const asked = run(start(), { type: "draftChanged", text: "为什么" }, { type: "send" });
    const id = asked.answer?.id ?? -1;
    const failed = run(
      asked,
      { type: "answerChunk", id, text: "因" },
      { type: "answerFailed", id, message: "大模型接口出错（HTTP 502）" },
    );
    expect(failed.mode).toBe("paused");
    expect(failed.answer).toMatchObject({ error: "大模型接口出错（HTTP 502）", text: "因" });

    const retried = sessionReducer(failed, { type: "retryAnswer" });
    expect(retried.mode).toBe("answering");
    expect(retried.answer).toMatchObject({
      question: "为什么",
      history: [],
      text: "",
      error: null,
    });
    expect(retried.answer?.id).not.toBe(id);
    expect(retried.transcript).toEqual([{ role: "user", text: "为什么" }]);
    expect(sessionReducer(retried, { type: "answerChunk", id, text: "旧" })).toBe(retried);
  });

  it("answers Multica calls too, grounded in the full report", () => {
    const multica = createSession(
      event({ status: "ready", brief, llmChannel: "primary", generatedAt: "" }, "multica"),
      split,
      "zh-CN",
    );
    expect(multica.report).toMatchObject({ source: "multica", content: "原始汇报全文" });
    const asked = run(multica, { type: "draftChanged", text: "先别发版" }, { type: "send" });
    expect(asked.mode).toBe("answering");
    expect(asked.answer).toMatchObject({ question: "先别发版", history: [], error: null });
    expect(asked.transcript).toEqual([{ role: "user", text: "先别发版" }]);

    const resumed = run(multica, { type: "draftChanged", text: "继续" }, { type: "send" });
    expect([resumed.mode, resumed.transcript, resumed.answer]).toEqual(["playing", [], null]);
  });

  it("does not retry an answer that has not failed", () => {
    const asked = run(start(), { type: "draftChanged", text: "为什么" }, { type: "send" });
    const done = run(asked, { type: "answerDone", id: asked.answer?.id ?? -1 });
    expect(sessionReducer(done, { type: "retryAnswer" })).toBe(done);
  });

  it("records decision clicks with the latest choice winning and a transcript line each", () => {
    const s = run(
      start(),
      { type: "decide", decisionId: "d1", choice: "现在发" },
      { type: "resume" },
      { type: "decide", decisionId: "d1", choice: "明天发" },
      { type: "decide", decisionId: "unknown", choice: "x" },
    );
    expect(s.mode).toBe("paused");
    expect(s.choices).toEqual([{ decisionId: "d1", question: "要不要发版?", choice: "明天发" }]);
    expect(s.transcript).toEqual([
      { role: "user", text: "选择:要不要发版? -> 现在发" },
      { role: "user", text: "选择:要不要发版? -> 明天发" },
    ]);
  });
});

describe("end of call", () => {
  it("stays paused when resumed after the brief finished", () => {
    const finished = playThrough(start());
    const back = run(finished, { type: "interrupt" }, { type: "resume" });
    expect(back.mode).toBe("paused");
    expect(back.playedToEnd).toBe(true);
  });

  it("treats 好的 after playback as a normal question", () => {
    const asked = run(
      playThrough(start()),
      { type: "draftChanged", text: "好的。" },
      { type: "send" },
    );
    expect(asked.mode).toBe("answering");
    expect(asked.transcript).toEqual([{ role: "user", text: "好的。" }]);
  });

  it("hangs up mid-answer, keeping what was said, and ignores everything after", () => {
    const asked = run(start(), { type: "draftChanged", text: "为什么" }, { type: "send" });
    const id = asked.answer?.id ?? -1;
    const ended = run(asked, { type: "answerChunk", id, text: "因为" }, { type: "hangUp" });
    expect([ended.mode, ended.answer, ended.draft]).toEqual(["ended", null, ""]);
    expect(ended.transcript).toEqual([
      { role: "user", text: "为什么" },
      { role: "assistant", text: "因为" },
    ]);
    for (const action of [
      { type: "listenStart" },
      { type: "draftChanged", text: "再问" },
      { type: "decide", decisionId: "d1", choice: "现在发" },
      { type: "jump", segment: 1 },
      { type: "answerChunk", id, text: "迟到" },
      { type: "hangUp" },
    ] satisfies SessionAction[]) {
      expect(sessionReducer(ended, action)).toBe(ended);
    }
  });
});
