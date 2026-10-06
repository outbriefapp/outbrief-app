import { describe, expect, it } from "vitest";
import { VoiceHttpError } from "../errors.ts";
import {
  audioFromJson,
  base64ToBytes,
  hexToBytes,
  jsonDocuments,
  pcm16ToWav,
  sniffAudio,
  toAudioBlob,
  valueAt,
} from "./audio.ts";

const MP3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0, 0, 0, 0]);

describe("audio decoding", () => {
  it("decodes base64, base64url and data URLs", () => {
    expect([...base64ToBytes("SGk=")]).toEqual([72, 105]);
    // Unpadded base64url, as some APIs send it.
    expect([...base64ToBytes("_-8")]).toEqual([255, 239]);
    expect([...base64ToBytes("data:audio/mpeg;base64,SGk=")]).toEqual([72, 105]);
    // Line breaks inside a long field.
    expect([...base64ToBytes("SG\nk=")]).toEqual([72, 105]);
  });

  it("decodes hex audio and rejects what is not hex", () => {
    expect([...hexToBytes("00ff10")]).toEqual([0, 255, 16]);
    expect(() => hexToBytes("xyz")).toThrow();
    expect(() => hexToBytes("abc")).toThrow();
  });

  it("recognises the audio containers TTS APIs return", () => {
    expect(sniffAudio(MP3)).toBe("audio/mpeg");
    expect(sniffAudio(new Uint8Array([0xff, 0xfb, 0x90, 0]))).toBe("audio/mpeg");
    expect(sniffAudio(new TextEncoder().encode("RIFF\0\0\0\0WAVE"))).toBe("audio/wav");
    expect(sniffAudio(new TextEncoder().encode("OggS\0"))).toBe("audio/ogg");
    expect(sniffAudio(new TextEncoder().encode("\0\0\0\0ftypM4A "))).toBe("audio/mp4");
    expect(sniffAudio(new TextEncoder().encode('{"error":1}'))).toBeNull();
  });

  it("wraps headerless PCM in a WAV header", async () => {
    const pcm = new Uint8Array([1, 0, 2, 0]);
    const blob = pcm16ToWav(pcm, 24000);
    expect(blob.type).toBe("audio/wav");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const view = new DataView(bytes.buffer);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(24000);
    expect(view.getUint16(34, true)).toBe(16); // bits
    expect(view.getUint32(40, true)).toBe(4); // data length
    expect(bytes.byteLength).toBe(48);
  });

  it("refuses bytes that are not audio, with the body in the message", () => {
    const body = new TextEncoder().encode('{"error":"quota exceeded"}');
    expect(() => toAudioBlob(body, { kind: "auto" })).toThrow(/quota exceeded/);
    expect(() => toAudioBlob(new Uint8Array(), { kind: "auto" })).toThrow(VoiceHttpError);
  });

  it("trusts the declared format for PCM, which has no header to sniff", () => {
    const pcm = new Uint8Array([1, 0, 2, 0]);
    expect(toAudioBlob(pcm, { kind: "pcm16", sampleRate: 16000 }).type).toBe("audio/wav");
  });
});

describe("valueAt", () => {
  const json = { data: { audio: "x" }, candidates: [{ parts: [{ inline: { data: "y" } }] }] };

  it("reads dotted paths, array indices and bracket indices", () => {
    expect(valueAt(json, "data.audio")).toBe("x");
    expect(valueAt(json, "candidates.0.parts.0.inline.data")).toBe("y");
    expect(valueAt(json, "candidates[0].parts[0].inline.data")).toBe("y");
    expect(valueAt(json, "")).toBe(json);
  });

  it("is undefined for a path that is not there", () => {
    expect(valueAt(json, "data.missing")).toBeUndefined();
    expect(valueAt(json, "data.audio.deeper")).toBeUndefined();
    expect(valueAt(null, "a.b")).toBeUndefined();
  });
});

describe("jsonDocuments", () => {
  it("reads one JSON document", () => {
    expect(jsonDocuments(' {"a":1} ')).toEqual([{ a: 1 }]);
  });

  it("reads one document per line, as streaming TTS APIs send", () => {
    expect(jsonDocuments('{"a":1}\n{"a":2}\n')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("reads SSE frames, skipping event lines and [DONE]", () => {
    const body = 'event: 352\ndata: {"code":0,"data":"AA"}\n\nevent: 152\ndata: [DONE]\n';
    expect(jsonDocuments(body)).toEqual([{ code: 0, data: "AA" }]);
  });

  it("throws for a body that is not JSON at all", () => {
    expect(() => jsonDocuments("<html>502 Bad Gateway</html>")).toThrow(VoiceHttpError);
    expect(() => jsonDocuments("")).toThrow(VoiceHttpError);
  });
});

describe("audioFromJson", () => {
  it("joins the audio chunks of every document, in order", () => {
    const docs = [{ d: "AAE=" }, { d: "AgM=" }];
    expect([...audioFromJson(docs, "d", "base64")]).toEqual([0, 1, 2, 3]);
  });

  it("skips documents without audio (progress and final frames)", () => {
    const docs = [
      { code: 0, d: "AAE=" },
      { code: 0, d: null },
      { code: 20000000, usage: {} },
    ];
    expect([...audioFromJson(docs, "d", "base64")]).toEqual([0, 1]);
  });

  it("decodes hex audio, as MiniMax returns it", () => {
    expect([...audioFromJson([{ data: { audio: "00ff" } }], "data.audio", "hex")]).toEqual([
      0, 255,
    ]);
  });

  it("names the path and shows the response when no document has audio", () => {
    expect(() =>
      audioFromJson([{ base_resp: { status_code: 1004 } }], "data.audio", "hex"),
    ).toThrow(/data\.audio.*1004/s);
  });
});
