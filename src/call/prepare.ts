import type { AgentEvent } from "../protocol.ts";
import {
  type SpeechLanguage,
  type SpeechSynth,
  splitSentences,
  type VoiceOptions,
} from "../voice/index.ts";
import { createSession } from "./session.ts";

/** Every sentence the call on `event` speaks from its brief, in playback order. */
export function reportSentences(event: AgentEvent, language: SpeechLanguage): string[] {
  return createSession(event, splitSentences, language).segments.flatMap((s) => s.sentences);
}

/**
 * Synthesizes all of a report's speech before its call rings, so playback never waits on TTS. The
 * audio lands in the synthesizer's cache, where the call's player finds it. Rejects on the first
 * sentence that cannot be synthesized (the other requests are aborted) or when `signal` aborts.
 */
export async function prepareSpeech(
  event: AgentEvent,
  synth: SpeechSynth,
  opts: VoiceOptions,
  language: SpeechLanguage,
  signal: AbortSignal,
): Promise<void> {
  const ctrl = new AbortController();
  const stop = () => ctrl.abort();
  signal.addEventListener("abort", stop, { once: true });
  try {
    await Promise.all(
      [...new Set(reportSentences(event, language))].map((text) =>
        synth.synthesize(text, opts, ctrl.signal).catch((err: unknown) => {
          ctrl.abort();
          throw err;
        }),
      ),
    );
  } finally {
    signal.removeEventListener("abort", stop);
  }
}
