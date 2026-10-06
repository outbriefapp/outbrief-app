/** Sample rate Azure STT expects. */
export const STT_SAMPLE_RATE = 16_000;

/**
 * Resamples mono float audio. Downsampling averages every source sample that falls into an output
 * sample's window (a box low-pass filter, enough to keep speech free of aliasing hiss); upsampling
 * interpolates linearly.
 */
export function resample(
  input: Float32Array,
  fromRate: number,
  toRate = STT_SAMPLE_RATE,
): Float32Array {
  const ratio = fromRate / toRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < output.length; i++) {
    if (ratio > 1) {
      const start = Math.floor(i * ratio);
      const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
      let sum = 0;
      for (let j = start; j < end; j++) sum += input[j] ?? 0;
      output[i] = sum / (end - start);
    } else {
      const pos = i * ratio;
      const left = Math.floor(pos);
      const a = input[left] ?? 0;
      const b = input[left + 1] ?? a;
      output[i] = a + (b - a) * (pos - left);
    }
  }
  return output;
}

/** Float samples in [-1, 1] → clamped signed 16-bit PCM. */
export function toPcm16(samples: Float32Array): Int16Array {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm;
}

/** Canonical 44-byte-header RIFF/WAVE file for mono 16-bit PCM. */
export function encodeWav(pcm: Int16Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + pcm.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcm.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, pcm.length * 2, true);
  new Int16Array(buffer, 44).set(pcm);
  return buffer;
}

/** Parses a mono 16-bit PCM WAV (any chunk layout). Throws for anything else. */
export function decodeWav(buffer: ArrayBuffer): { sampleRate: number; pcm: Int16Array } {
  const view = new DataView(buffer);
  const tag = (offset: number) =>
    String.fromCharCode(...new Uint8Array(buffer, offset, Math.min(4, buffer.byteLength - offset)));
  if (buffer.byteLength < 12 || tag(0) !== "RIFF" || tag(8) !== "WAVE") {
    throw new Error("not a WAV file");
  }
  let sampleRate = 0;
  for (let offset = 12; offset + 8 <= buffer.byteLength; ) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt ") {
      const format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || channels !== 1 || bits !== 16) {
        throw new Error(`unsupported WAV: format ${format}, ${channels} ch, ${bits} bit`);
      }
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === "data") {
      if (!sampleRate) throw new Error("WAV data chunk precedes fmt chunk");
      const bytes = Math.min(size, buffer.byteLength - body) & ~1;
      return { sampleRate, pcm: new Int16Array(buffer.slice(body, body + bytes)) };
    }
    offset = body + size + (size % 2);
  }
  throw new Error("WAV has no data chunk");
}
