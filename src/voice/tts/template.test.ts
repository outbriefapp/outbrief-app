import { describe, expect, it } from "vitest";
import { VoiceHttpError } from "../errors.ts";
import { parseCurl, withGuessedPlaceholders } from "./curl.ts";
import {
  DEFAULT_RESPONSE,
  EMPTY_TEMPLATE,
  type HttpTemplate,
  readTemplateResponse,
  renderTemplate,
  synthesizeWithTemplate,
  templateProblem,
  templateValues,
} from "./template.ts";
import { EMPTY_TTS_CONFIG } from "./types.ts";

const INPUT = {
  text: '他说"你好"\n换行了',
  voice: "v1",
  model: "m1",
  rate: 1.25,
  language: "zh-CN",
};

function template(over: Partial<HttpTemplate> = {}): HttpTemplate {
  return {
    method: "POST",
    url: "https://api.example.com/tts",
    headers: [{ name: "Content-Type", value: "application/json" }],
    body: '{"text":"{{text}}","voice":"{{voice}}","speed":{{speed}}}',
    response: DEFAULT_RESPONSE,
    ...over,
  };
}

describe("renderTemplate", () => {
  it("escapes the sentence for a JSON body, so quotes and newlines stay valid JSON", () => {
    const req = renderTemplate(template(), templateValues(INPUT));
    expect(req.body).toBeDefined();
    expect(JSON.parse(req.body as string)).toEqual({
      text: '他说"你好"\n换行了',
      voice: "v1",
      speed: 1.25,
    });
  });

  it("escapes for a form body and for XML, by the Content-Type", () => {
    const form = renderTemplate(
      template({
        headers: [{ name: "Content-Type", value: "application/x-www-form-urlencoded" }],
        body: "text={{text}}&voice={{voice}}",
      }),
      templateValues({ ...INPUT, text: "a&b=c" }),
    );
    expect(form.body).toBe("text=a%26b%3Dc&voice=v1");
    const xml = renderTemplate(
      template({
        headers: [{ name: "Content-Type", value: "application/ssml+xml" }],
        body: "<speak>{{text}}</speak>",
      }),
      templateValues({ ...INPUT, text: "a<b & c" }),
    );
    expect(xml.body).toBe("<speak>a&lt;b &amp; c</speak>");
  });

  it("url-encodes values in the URL and leaves header values as they are", () => {
    const req = renderTemplate(
      template({
        method: "GET",
        url: "https://api.example.com/tts?text={{text}}&v={{voice}}",
        headers: [{ name: "X-Voice", value: "id {{voice}}" }],
        body: "ignored for GET",
      }),
      templateValues({ ...INPUT, text: "a b&c" }),
    );
    expect(req.url).toBe("https://api.example.com/tts?text=a%20b%26c&v=v1");
    expect(req.headers["X-Voice"]).toBe("id v1");
    // A GET carries no body even when one was typed.
    expect(req.body).toBeUndefined();
  });

  it("keeps an unknown placeholder as it stands, instead of emptying it", () => {
    const req = renderTemplate(template({ body: "{{nope}}|{{ text }}" }), templateValues(INPUT));
    expect(req.body).toBe('{{nope}}|他说\\"你好\\"\\n换行了');
  });

  it("fills a fresh uuid and a timestamp per sentence", () => {
    const first = templateValues(INPUT);
    expect(first.uuid).not.toBe(templateValues(INPUT).uuid);
    expect(Number(first.timestamp)).toBeGreaterThan(1_700_000_000);
  });
});

describe("templateProblem", () => {
  it("accepts a request that has a URL and the sentence", () => {
    expect(templateProblem(template())).toBeNull();
    // {{text}} may sit in the URL of a GET request instead.
    expect(
      templateProblem(template({ method: "GET", url: "https://x.test/say?t={{text}}", body: "" })),
    ).toBeNull();
  });

  it("reports a missing or non-http URL, and a placeholder URL is judged by its shape", () => {
    expect(templateProblem(template({ url: "" }))).toBe("url");
    expect(templateProblem(template({ url: "api.example.com/tts" }))).toBe("url");
    expect(templateProblem(template({ url: "https://{{voice}}.example.com/x" }))).toBeNull();
  });

  it("reports a request that would not speak the sentence", () => {
    expect(templateProblem(template({ body: '{"text":"hello"}' }))).toBe("text");
    // The sentence may be carried by a header.
    expect(
      templateProblem(template({ body: "{}", headers: [{ name: "X-Text", value: "{{text}}" }] })),
    ).toBeNull();
  });

  it("reports a JSON response without a field path", () => {
    const response = { ...DEFAULT_RESPONSE, source: "json" as const, path: "  " };
    expect(templateProblem(template({ response }))).toBe("path");
    expect(templateProblem(template({ response: { ...response, path: "data.audio" } }))).toBeNull();
  });

  it("marks the empty template as incomplete, so it is never sent", () => {
    expect(templateProblem(EMPTY_TEMPLATE)).toBe("url");
  });
});

const MP3 = "SUQzBAAAAAAA"; // "ID3\4\0\0\0\0\0"

function ctx(fetchImpl: typeof fetch = globalThis.fetch) {
  return { fetch: fetchImpl };
}

describe("readTemplateResponse", () => {
  it("takes the body as the audio file", async () => {
    const resp = new Response(new Uint8Array([0x49, 0x44, 0x33, 4]), {
      headers: { "Content-Type": "audio/mpeg" },
    });
    const blob = await readTemplateResponse(resp, DEFAULT_RESPONSE, ctx());
    expect(blob.type).toBe("audio/mpeg");
  });

  it("rejects an HTTP error with its status, so the retry policy can see it", async () => {
    const resp = new Response("rate limited", { status: 429 });
    await expect(readTemplateResponse(resp, DEFAULT_RESPONSE, ctx())).rejects.toMatchObject({
      name: "VoiceHttpError",
      status: 429,
    });
  });

  it("rejects a JSON error body that came back with HTTP 200", async () => {
    const resp = new Response('{"error":"bad voice"}', {
      headers: { "Content-Type": "application/json" },
    });
    await expect(readTemplateResponse(resp, DEFAULT_RESPONSE, ctx())).rejects.toThrow(/bad voice/);
  });

  it("reads base64 audio out of a JSON field", async () => {
    const resp = new Response(JSON.stringify({ data: { audio: MP3 } }));
    const spec = { ...DEFAULT_RESPONSE, source: "json" as const, path: "data.audio" };
    expect((await readTemplateResponse(resp, spec, ctx())).type).toBe("audio/mpeg");
  });

  it("downloads the audio when the field holds a URL", async () => {
    const resp = new Response(JSON.stringify({ url: "https://cdn.test/a.mp3" }));
    const spec = {
      ...DEFAULT_RESPONSE,
      source: "json" as const,
      path: "url",
      encoding: "url" as const,
    };
    const downloads: string[] = [];
    const download: typeof fetch = async (input) => {
      downloads.push(String(input));
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 4]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    };
    const blob = await readTemplateResponse(resp, spec, ctx(download));
    expect(downloads).toEqual(["https://cdn.test/a.mp3"]);
    expect(blob.type).toBe("audio/mpeg");
  });

  it("adds a WAV header to headerless PCM at the sample rate given", async () => {
    const resp = new Response(new Uint8Array([1, 0, 2, 0]));
    const spec = { ...DEFAULT_RESPONSE, format: "pcm16" as const, sampleRate: 16000 };
    const blob = await readTemplateResponse(resp, spec, ctx());
    expect(blob.type).toBe("audio/wav");
    const view = new DataView(await blob.arrayBuffer());
    expect(view.getUint32(24, true)).toBe(16000);
  });
});

describe("synthesizeWithTemplate", () => {
  it("sends the rendered request and returns the audio", async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      seen.push({ url: String(url), init });
      return new Response(new Uint8Array([0x49, 0x44, 0x33, 4]), {
        headers: { "Content-Type": "audio/mpeg" },
      });
    };
    const blob = await synthesizeWithTemplate(template(), INPUT, { fetch: fetchImpl });
    expect(blob.type).toBe("audio/mpeg");
    expect(seen[0]?.url).toBe("https://api.example.com/tts");
    expect(seen[0]?.init?.method).toBe("POST");
  });

  it("refuses to send an incomplete request instead of calling a wrong URL", async () => {
    const fetchImpl: typeof fetch = () => {
      throw new Error("must not be called");
    };
    await expect(
      synthesizeWithTemplate(EMPTY_TEMPLATE, INPUT, { fetch: fetchImpl }),
    ).rejects.toBeInstanceOf(VoiceHttpError);
  });
});

describe("EMPTY_TTS_CONFIG", () => {
  it("is empty, so a new engine starts with nothing filled in", () => {
    expect(EMPTY_TTS_CONFIG).toEqual({ values: {}, model: "", voice: "" });
  });
});

describe("a request imported from cURL", () => {
  it("renders back to valid JSON, the numeric speed unquoted", () => {
    const imported = withGuessedPlaceholders(
      parseCurl(
        `curl https://api.openai.com/v1/audio/speech --json '{"model":"gpt-4o-mini-tts","input":"hi","voice":"marin","speed":1}'`,
      ),
    );
    const req = renderTemplate(imported, templateValues(INPUT));
    expect(JSON.parse(req.body as string)).toEqual({
      model: "gpt-4o-mini-tts",
      input: '他说"你好"\n换行了',
      voice: "v1",
      // A number, not a string: the placeholder was left unquoted on purpose.
      speed: 1.25,
    });
  });
});
