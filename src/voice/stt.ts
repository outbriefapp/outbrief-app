import { withAzureRetry } from "./azureRequest.ts";
import { azureTokens } from "./azureToken.ts";
import { ensureNotAborted, responseSnippet, VoiceHttpError } from "./errors.ts";
import { decodeWav, encodeWav } from "./wav.ts";

/** The short-audio REST endpoint rejects anything over 60 s; chunks stay safely below. */
const MAX_SINGLE_REQUEST_SECONDS = 60;
const CHUNK_SECONDS = 55;
const EMPTY_STATUSES = ["NoMatch", "InitialSilenceTimeout", "BabbleTimeout"];

async function recognize(
  audio: Blob | ArrayBuffer,
  sampleRate: number,
  language: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const query = new URLSearchParams({ language, format: "simple" });
  return withAzureRetry(
    azureTokens,
    async ({ region, token }) => {
      const resp = await fetch(
        `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?${query}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `audio/wav; codecs=audio/pcm; samplerate=${sampleRate}`,
            Accept: "application/json",
          },
          body: audio,
          signal,
        },
      );
      if (!resp.ok) {
        throw new VoiceHttpError(
          `Azure STT HTTP ${resp.status}: ${await responseSnippet(resp)}`,
          resp.status,
        );
      }
      const result = (await resp.json()) as { RecognitionStatus?: string; DisplayText?: string };
      if (result.RecognitionStatus === "Success") return result.DisplayText ?? "";
      if (EMPTY_STATUSES.includes(result.RecognitionStatus ?? "")) return "";
      throw new VoiceHttpError(`Azure STT status ${result.RecognitionStatus}`);
    },
    signal,
  );
}

/** Joins chunk transcripts, adding a space only between two non-CJK neighbours. */
function joinTranscripts(parts: string[]): string {
  const cjk = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{P}]/u;
  return parts
    .map((p) => p.trim())
    .filter(Boolean)
    .reduce((joined, part) => {
      if (!joined) return part;
      return cjk.test(joined.at(-1) ?? "") && cjk.test(part[0] ?? "")
        ? joined + part
        : `${joined} ${part}`;
    }, "");
}

/** Azure STT (same JWT as TTS). Input: 16 kHz mono 16-bit PCM WAV blob. Splits > 60 s into chunks and joins text. Returns "" for silence. */
export async function transcribe(
  wav: Blob,
  opts: { language: string },
  signal?: AbortSignal,
): Promise<string> {
  ensureNotAborted(signal);
  const { sampleRate, pcm } = decodeWav(await wav.arrayBuffer());
  if (pcm.length <= MAX_SINGLE_REQUEST_SECONDS * sampleRate) {
    return (await recognize(wav, sampleRate, opts.language, signal)).trim();
  }
  const chunkSamples = CHUNK_SECONDS * sampleRate;
  const chunks: ArrayBuffer[] = [];
  for (let start = 0; start < pcm.length; start += chunkSamples) {
    chunks.push(encodeWav(pcm.subarray(start, start + chunkSamples), sampleRate));
  }
  const parts = await Promise.all(
    chunks.map((chunk) => recognize(chunk, sampleRate, opts.language, signal)),
  );
  return joinTranscripts(parts);
}
