import { createPcmWorkletUrl, PCM_CAPTURE_PROCESSOR, type PcmMessage } from "./pcmWorklet.ts";
import { encodeWav, resample, STT_SAMPLE_RATE, toPcm16 } from "./wav.ts";

const FLUSH_TIMEOUT_MS = 1_000;

interface Capture {
  stream: MediaStream;
  context: AudioContext;
  node: AudioWorkletNode;
  chunks: Float32Array[];
}

/** Microphone capture via AudioWorklet, resampled to 16 kHz mono PCM16. */
export class Recorder {
  #capture: Capture | undefined;
  #starting: Promise<Capture> | undefined;
  #cancelled = false;

  get recording(): boolean {
    return this.#capture !== undefined || this.#starting !== undefined;
  }

  /**
   * Asks for microphone permission and starts capturing; throws if denied or unavailable, or with
   * `AbortError` when `cancel()` was called while the permission prompt was still open.
   */
  async start(): Promise<void> {
    if (this.recording) throw new Error("Recorder is already recording");
    this.#cancelled = false;
    this.#starting = Recorder.#open();
    try {
      const capture = await this.#starting;
      if (this.#cancelled) {
        Recorder.#release(capture);
        throw new DOMException("Recording was cancelled.", "AbortError");
      }
      this.#capture = capture;
    } finally {
      this.#starting = undefined;
    }
  }

  /** Stops capturing, releases the microphone and returns the recording as a 16 kHz WAV. */
  async stop(): Promise<Blob> {
    // A quick push-to-talk release can arrive before the permission prompt resolved.
    await this.#starting?.catch(() => undefined);
    const capture = this.#capture;
    if (!capture) throw new Error("Recorder is not recording");
    this.#capture = undefined;
    const { node, chunks, context } = capture;
    // Executor form: the ES2023 lib targeted by tsconfig has no Promise.withResolvers.
    const tail = await new Promise<Float32Array>((resolve) => {
      // An interrupted AudioContext never answers; keep what arrived instead of hanging.
      const timer = setTimeout(() => resolve(new Float32Array(0)), FLUSH_TIMEOUT_MS);
      node.port.onmessage = (e: MessageEvent<PcmMessage>) => {
        if (!e.data.last) chunks.push(e.data.samples);
        else {
          clearTimeout(timer);
          resolve(e.data.samples);
        }
      };
      node.port.postMessage("flush");
    });
    chunks.push(tail);
    const sampleRate = context.sampleRate;
    Recorder.#release(capture);

    const samples = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    const pcm = toPcm16(resample(samples, sampleRate, STT_SAMPLE_RATE));
    return new Blob([encodeWav(pcm, STT_SAMPLE_RATE)], { type: "audio/wav" });
  }

  /** Stops capturing and discards the audio. */
  cancel(): void {
    this.#cancelled = this.#starting !== undefined;
    const capture = this.#capture;
    this.#capture = undefined;
    if (capture) Recorder.#release(capture);
  }

  static async #open(): Promise<Capture> {
    let stream: MediaStream | undefined;
    let context: AudioContext | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
      });
      context = new AudioContext();
      const url = createPcmWorkletUrl();
      try {
        await context.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const node = new AudioWorkletNode(context, PCM_CAPTURE_PROCESSOR);
      const chunks: Float32Array[] = [];
      node.port.onmessage = (e: MessageEvent<PcmMessage>) => {
        if (!e.data.last) chunks.push(e.data.samples);
      };
      context.createMediaStreamSource(stream).connect(node);
      // Some engines only pull nodes reachable from the destination; the worklet outputs silence.
      node.connect(context.destination);
      await context.resume();
      return { stream, context, node, chunks };
    } catch (err) {
      for (const track of stream?.getTracks() ?? []) track.stop();
      void context?.close();
      throw err;
    }
  }

  static #release({ stream, context, node }: Capture): void {
    for (const track of stream.getTracks()) track.stop();
    node.port.onmessage = null;
    node.disconnect();
    void context.close();
  }
}
