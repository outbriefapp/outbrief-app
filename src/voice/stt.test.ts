import { afterEach, describe, expect, it, vi } from "vitest";
import { transcribe } from "./stt.ts";
import { decodeWav, encodeWav } from "./wav.ts";

const JWT = `h.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.s`;

function wavBlob(seconds: number): Blob {
  return new Blob([encodeWav(new Int16Array(seconds * 16_000), 16_000)], { type: "audio/wav" });
}

/** Stubs the token endpoint and answers STT requests with `reply(audio)`. */
function stubStt(reply: (audio: { seconds: number; first: number }) => object) {
  const requests: { url: string; headers: Headers; seconds: number }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://dev.microsofttranslator.com/")) {
        return Response.json({ r: "eastasia", t: JWT });
      }
      const body = init?.body;
      const buffer = body instanceof Blob ? await body.arrayBuffer() : (body as ArrayBuffer);
      const { pcm } = decodeWav(buffer);
      const seconds = pcm.length / 16_000;
      requests.push({ url, headers: new Headers(init?.headers), seconds });
      return Response.json(reply({ seconds, first: pcm[0] ?? 0 }));
    }),
  );
  return requests;
}

describe("transcribe", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts short audio once to the conversation endpoint", async () => {
    const requests = stubStt(() => ({ RecognitionStatus: "Success", DisplayText: "你好。" }));
    expect(await transcribe(wavBlob(3), { language: "zh-CN" })).toBe("你好。");
    expect(requests).toHaveLength(1);
    const [req] = requests;
    expect(req?.url).toBe(
      "https://eastasia.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=zh-CN&format=simple",
    );
    expect(req?.headers.get("Authorization")).toBe(`Bearer ${JWT}`);
    expect(req?.headers.get("Content-Type")).toBe("audio/wav; codecs=audio/pcm; samplerate=16000");
  });

  it("returns an empty string for silence", async () => {
    stubStt(() => ({ RecognitionStatus: "InitialSilenceTimeout" }));
    expect(await transcribe(wavBlob(2), { language: "zh-CN" })).toBe("");
  });

  it("splits audio longer than 60 s into ≤ 55 s chunks and joins the text in order", async () => {
    // Every sample carries its chunk number so the stub can tell the chunks apart.
    const pcm = Int16Array.from({ length: 130 * 16_000 }, (_, i) => Math.floor(i / (55 * 16_000)));
    const texts = ["第一段。", "第二段。", "Third part"];
    const requests = stubStt(({ first }) => ({
      RecognitionStatus: "Success",
      DisplayText: texts[first],
    }));
    const wav = new Blob([encodeWav(pcm, 16_000)], { type: "audio/wav" });
    const text = await transcribe(wav, { language: "zh-CN" });
    expect(requests.map((r) => r.seconds)).toEqual([55, 55, 20]);
    expect(text).toBe("第一段。第二段。 Third part");
  });

  it("keeps a 60 s recording in a single request", async () => {
    const requests = stubStt(() => ({ RecognitionStatus: "NoMatch" }));
    expect(await transcribe(wavBlob(60), { language: "en-US" })).toBe("");
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("language=en-US");
  });
});
