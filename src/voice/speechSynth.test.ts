import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AudioCache } from "./audioCache.ts";
import { AzureTokenProvider } from "./azureToken.ts";
import { VoiceUnavailableError } from "./errors.ts";
import { SpeechSynthService } from "./speechSynth.ts";
import { createAzureEngine } from "./tts/engines/azure.ts";
import { EMPTY_TTS_CONFIG } from "./tts/types.ts";
import type { VoiceOptions } from "./voices.ts";

const OPTS: VoiceOptions = {
  engine: "azure",
  config: EMPTY_TTS_CONFIG,
  voice: "zh-CN-XiaoxiaoMultilingualNeural",
  rate: 1,
  language: "zh-CN",
};

function fakeJwt(id: number): string {
  const payload = btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, id }));
  return `header.${payload.replace(/=+$/, "")}.sig`;
}

function audio(body: string): Response {
  return new Response(body, { headers: { "Content-Type": "audio/mpeg" } });
}

interface Calls {
  endpoint: number;
  azure: string[];
}

/** Routes stubbed fetches: token endpoint → fresh JWT, Azure TTS → `azure(token)`; nothing else. */
function stubFetch(azure: (token: string) => Response | Promise<Response>) {
  const calls: Calls = { endpoint: 0, azure: [] };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("https://dev.microsofttranslator.com/")) {
        calls.endpoint += 1;
        return Response.json({ r: "eastasia", t: fakeJwt(calls.endpoint) });
      }
      if (url === "https://eastasia.tts.speech.microsoft.com/cognitiveservices/v1") {
        const token = new Headers(init?.headers).get("Authorization") ?? "";
        calls.azure.push(token);
        return azure(token);
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
  return calls;
}

function newSynth() {
  const azure = createAzureEngine(new AzureTokenProvider());
  return new SpeechSynthService(
    new AudioCache(200, null),
    () => globalThis.fetch,
    () => azure,
  );
}

describe("SpeechSynthService", () => {
  beforeEach(() => {
    vi.spyOn(Math, "random").mockReturnValue(0);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns client audio on success", async () => {
    const calls = stubFetch(() => audio("azure-mp3"));
    const blob = await newSynth().synthesize("你好，世界。", OPTS);
    expect(await blob.text()).toBe("azure-mp3");
    expect(blob.type).toBe("audio/mpeg");
    expect(calls).toMatchObject({ endpoint: 1 });
  });

  it("does not retry a 400 and never falls back to the server", async () => {
    const calls = stubFetch(() => new Response("bad ssml", { status: 400 }));
    await expect(newSynth().synthesize("第一句话。", OPTS)).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    expect(calls.azure).toHaveLength(1);
  });

  it("on 401 fetches a new token once and retries with it", async () => {
    const first = fakeJwt(1);
    const calls = stubFetch((token) =>
      token === first ? new Response("", { status: 401 }) : audio("azure-mp3"),
    );
    const blob = await newSynth().synthesize("刷新令牌。", OPTS);
    expect(await blob.text()).toBe("azure-mp3");
    expect(calls.endpoint).toBe(2);
    expect(calls.azure).toHaveLength(2);
    expect(calls.azure[1]).not.toBe(calls.azure[0]);
  });

  it("gives up after a second 401", async () => {
    const calls = stubFetch(() => new Response("", { status: 401 }));
    await expect(newSynth().synthesize("一直未授权。", OPTS)).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    expect(calls.endpoint).toBe(2);
    expect(calls.azure).toHaveLength(2);
  });

  it("retries 5xx twice with exponential backoff before giving up", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const calls = stubFetch(() => new Response("", { status: 503 }));
    let settled = false;
    const run = newSynth()
      .synthesize("服务器故障。", OPTS)
      .catch((err: unknown) => err)
      .finally(() => {
        settled = true;
      });
    let elapsed = 0;
    while (!settled) {
      // WebCrypto settles on a real event-loop turn, so yield one before advancing fake time.
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(100);
      elapsed += 100;
    }
    expect(await run).toBeInstanceOf(VoiceUnavailableError);
    expect(elapsed).toBeGreaterThanOrEqual(1_500); // 500 ms + 1000 ms
    expect(elapsed).toBeLessThan(2_000);
    expect(calls.azure).toHaveLength(3);
  });

  it("serves repeated sentences from the cache without fetching", async () => {
    const calls = stubFetch(() => audio("azure-mp3"));
    const synth = newSynth();
    await synth.synthesize("缓存命中。", OPTS);
    const again = await synth.synthesize("  缓存命中。 ", OPTS);
    expect(await again.text()).toBe("azure-mp3");
    expect(calls.azure).toHaveLength(1);
    await synth.synthesize("缓存命中。", { ...OPTS, rate: 1.2 });
    expect(calls.azure).toHaveLength(2);
  });

  it("keeps at most 3 requests in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    let release = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    stubFetch(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await gate;
      inFlight -= 1;
      return audio("azure-mp3");
    });
    const synth = newSynth();
    const runs = Array.from({ length: 7 }, (_, i) => synth.synthesize(`第${i}句话。`, OPTS));
    await vi.waitFor(() => expect(inFlight).toBe(3));
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
    expect(inFlight).toBe(3);
    release();
    await Promise.all(runs);
    expect(peak).toBe(3);
  });

  it("rejects with AbortError once aborted", async () => {
    const controller = new AbortController();
    const calls = stubFetch(() => {
      controller.abort();
      return new Response("", { status: 503 });
    });
    const run = newSynth().synthesize("中途取消。", OPTS, controller.signal);
    await expect(run).rejects.toMatchObject({ name: "AbortError" });
    expect(calls.azure).toHaveLength(1);
  });
});
