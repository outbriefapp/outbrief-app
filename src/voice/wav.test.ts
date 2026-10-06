import { describe, expect, it } from "vitest";
import { decodeWav, encodeWav, resample, toPcm16 } from "./wav.ts";

describe("encodeWav", () => {
  it("writes a canonical mono PCM16 header followed by the samples", () => {
    const wav = encodeWav(new Int16Array([1, -2, 32767]), 16_000);
    const view = new DataView(wav);
    const ascii = (at: number) => String.fromCharCode(...new Uint8Array(wav, at, 4));
    expect(wav.byteLength).toBe(50);
    expect(ascii(0)).toBe("RIFF");
    expect(view.getUint32(4, true)).toBe(42);
    expect(ascii(8)).toBe("WAVE");
    expect(ascii(12)).toBe("fmt ");
    expect(view.getUint32(16, true)).toBe(16);
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint32(28, true)).toBe(32_000);
    expect(view.getUint16(32, true)).toBe(2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36)).toBe("data");
    expect(view.getUint32(40, true)).toBe(6);
    expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([
      1, -2, 32767,
    ]);
  });

  it("round-trips through decodeWav, skipping unknown chunks", () => {
    const plain = new Uint8Array(encodeWav(new Int16Array([5, 6, 7]), 16_000));
    // Insert a LIST chunk between fmt and data, as macOS `say` and many recorders do.
    const list = [...new TextEncoder().encode("LIST"), 3, 0, 0, 0, 1, 2, 3, 0];
    const withList = new Uint8Array([...plain.slice(0, 36), ...list, ...plain.slice(36)]);
    const decoded = decodeWav(withList.buffer);
    expect(decoded.sampleRate).toBe(16_000);
    expect([...decoded.pcm]).toEqual([5, 6, 7]);
  });

  it("rejects non-mono or non-16-bit audio", () => {
    const wav = encodeWav(new Int16Array(4), 16_000);
    new DataView(wav).setUint16(22, 2, true);
    expect(() => decodeWav(wav)).toThrow(/unsupported WAV/);
    expect(() => decodeWav(new ArrayBuffer(8))).toThrow(/not a WAV/);
  });
});

describe("toPcm16", () => {
  it("scales and clamps to the int16 range", () => {
    expect([...toPcm16(new Float32Array([0, 1, -1, 2, -2, 0.5]))]).toEqual([
      0, 32767, -32768, 32767, -32768, 16383,
    ]);
  });
});

describe("resample", () => {
  it("produces the duration-preserving number of samples", () => {
    expect(resample(new Float32Array(48_000), 48_000)).toHaveLength(16_000);
    expect(resample(new Float32Array(44_100), 44_100)).toHaveLength(16_000);
    expect(resample(new Float32Array(4_410), 44_100)).toHaveLength(1_600);
    expect(resample(new Float32Array(8_000), 8_000)).toHaveLength(16_000);
  });

  it("averages each output window when downsampling", () => {
    const out = resample(new Float32Array([0, 0.3, 0.6, 1, 1, 1]), 48_000);
    expect([...out].map((v) => Number(v.toFixed(3)))).toEqual([0.3, 1]);
  });

  it("removes a tone above the target Nyquist frequency", () => {
    // 12 kHz sampled at 48 kHz alternates +1, 0, -1, 0; every 3-sample window cancels to ~0.
    const tone = Float32Array.from({ length: 4_800 }, (_, i) => Math.sin((i * Math.PI) / 2));
    const out = resample(tone, 48_000);
    const rms = Math.sqrt(out.reduce((s, v) => s + v * v, 0) / out.length);
    expect(rms).toBeLessThan(0.5);
  });
});
