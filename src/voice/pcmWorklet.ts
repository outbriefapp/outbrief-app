// AudioWorkletGlobalScope globals (the DOM lib does not declare them).
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

/** Name the capture processor is registered under. */
export const PCM_CAPTURE_PROCESSOR = "outbrief-pcm-capture";

/** Message posted by the capture worklet; `last` answers the main thread's flush request. */
export interface PcmMessage {
  samples: Float32Array;
  last: boolean;
}

/**
 * Worklet body. It is serialized with `Function#toString` into a Blob URL module, so it must stay
 * self-contained: no imports, no outer variables, only syntax that no build step rewrites into
 * helper calls (hence `declare`d, constructor-assigned properties instead of class fields).
 */
function pcmCaptureWorklet(processorName: string): void {
  class PcmCapture extends AudioWorkletProcessor {
    declare buffer: Float32Array;
    declare filled: number;
    declare done: boolean;

    constructor() {
      super();
      this.buffer = new Float32Array(4096);
      this.filled = 0;
      this.done = false;
      this.port.onmessage = () => {
        this.port.postMessage({ samples: this.buffer.slice(0, this.filled), last: true });
        this.done = true;
      };
    }

    process(inputs: Float32Array[][]): boolean {
      const channels = inputs[0];
      const frames = channels?.[0]?.length ?? 0;
      if (this.done || !channels) return !this.done;
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (const channel of channels) sum += channel[i] ?? 0;
        this.buffer[this.filled++] = sum / channels.length;
        if (this.filled === this.buffer.length) {
          this.port.postMessage({ samples: this.buffer.slice(), last: false });
          this.filled = 0;
        }
      }
      return true;
    }
  }
  registerProcessor(processorName, PcmCapture);
}

/**
 * Blob URL of the capture worklet module. A Blob keeps the worklet independent of how Vite serves
 * or bundles files in dev vs. production; the caller revokes it once `addModule` resolved.
 */
export function createPcmWorkletUrl(): string {
  const source = `(${pcmCaptureWorklet.toString()})(${JSON.stringify(PCM_CAPTURE_PROCESSOR)});`;
  return URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
}
