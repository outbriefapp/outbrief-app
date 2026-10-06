import { describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "../protocol.ts";
import type { SpeechSynth } from "../voice/index.ts";
import { degradedSpeech } from "../voice/languages.ts";
import { EMPTY_TTS_CONFIG } from "../voice/tts/types.ts";
import type { VoiceOptions } from "../voice/voices.ts";
import { prepareSpeech, reportSentences } from "./prepare.ts";

const OPTS: VoiceOptions = {
  engine: "azure",
  config: EMPTY_TTS_CONFIG,
  voice: "zh-CN-XiaoxiaoMultilingualNeural",
  rate: 1,
  language: "zh-CN",
};

function event(brief: AgentEvent["brief"]): AgentEvent {
  const at = "2026-09-25T00:00:00.000Z";
  return {
    id: "e1",
    seq: 1,
    source: "codex",
    content: "原始汇报",
    status: "received",
    occurredAt: at,
    receivedAt: at,
    brief,
  };
}

const withBrief = event({
  status: "ready",
  llmChannel: "primary",
  generatedAt: "2026-09-25T00:00:00.000Z",
  brief: {
    verdict: { status: "done", headline: "修好了" },
    facts: [],
    segments: [
      {
        id: "s1",
        speech: "登录修好了。测试全过。",
        card: { title: "a", bullets: [] },
        coveredFactIds: [],
      },
      { id: "s2", speech: "测试全过。", card: { title: "b", bullets: [] }, coveredFactIds: [] },
    ],
    decisions: [],
  },
});

describe("prepareSpeech", () => {
  it("synthesizes every distinct sentence of the brief before resolving", async () => {
    const synthesize = vi.fn(async () => new Blob(["mp3"]));
    await prepareSpeech(withBrief, { synthesize }, OPTS, "zh-CN", new AbortController().signal);
    const texts = synthesize.mock.calls.map((c) => (c as unknown[])[0]);
    expect(texts.sort()).toEqual([...new Set(reportSentences(withBrief, "zh-CN"))].sort());
    expect(texts.length).toBeGreaterThanOrEqual(2);
  });

  it("prepares the degraded sentence in the call language when there is no brief", () => {
    expect(reportSentences(event(null), "zh-CN")).toEqual([degradedSpeech("zh-CN")]);
    expect(reportSentences(event(null), "en-US")).toEqual([
      "I couldn't prepare a brief, so the full report is on your screen.",
    ]);
  });

  it("fails on the first sentence that cannot be synthesized and aborts the rest", async () => {
    const signals: AbortSignal[] = [];
    const synth: SpeechSynth = {
      synthesize: (text, _opts, signal) => {
        if (signal) signals.push(signal);
        return text.startsWith("登录")
          ? Promise.reject(new Error("语音服务暂不可用"))
          : new Promise(() => {});
      },
    };
    await expect(
      prepareSpeech(withBrief, synth, OPTS, "zh-CN", new AbortController().signal),
    ).rejects.toThrow("语音服务暂不可用");
    expect(signals.every((s) => s.aborted)).toBe(true);
  });
});
