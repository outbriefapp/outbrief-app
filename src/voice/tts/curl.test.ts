import { describe, expect, it } from "vitest";
import {
  parseCurl,
  putPlaceholder,
  requestSlots,
  shellWords,
  withGuessedPlaceholders,
} from "./curl.ts";
import { templateProblem } from "./template.ts";

describe("shellWords", () => {
  it("splits on whitespace and honours line continuations", () => {
    expect(shellWords("curl -X POST \\\n  https://x.test")).toEqual([
      "curl",
      "-X",
      "POST",
      "https://x.test",
    ]);
  });

  it("keeps single-quoted text whole, including JSON braces and double quotes", () => {
    expect(shellWords(`curl -d '{"a": "b c"}'`)).toEqual(["curl", "-d", '{"a": "b c"}']);
  });

  it("unescapes inside double quotes only where the shell would", () => {
    expect(shellWords('curl -H "A: \\"x\\"" -d "a\\nb"')).toEqual([
      "curl",
      "-H",
      'A: "x"',
      "-d",
      "a\\nb",
    ]);
  });

  it("reads $'…' escapes, as some docs paste them", () => {
    expect(shellWords("curl -d $'a\\nb'")).toEqual(["curl", "-d", "a\nb"]);
  });

  it("throws on an unclosed quote instead of silently truncating", () => {
    expect(() => shellWords("curl -d 'oops")).toThrow();
    expect(() => shellWords('curl -d "oops')).toThrow();
  });
});

describe("parseCurl", () => {
  it("reads the OpenAI TTS example: method, URL, headers and a pretty-printed body", () => {
    const template = parseCurl(`curl https://api.openai.com/v1/audio/speech \\
  -H "Authorization: Bearer $OPENAI_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-4o-mini-tts","input":"hi","voice":"marin"}' \\
  --output speech.mp3`);
    expect(template.method).toBe("POST");
    expect(template.url).toBe("https://api.openai.com/v1/audio/speech");
    expect(template.headers).toEqual([
      { name: "Authorization", value: "Bearer $OPENAI_API_KEY" },
      { name: "Content-Type", value: "application/json" },
    ]);
    // Re-indented so it can be edited on a phone.
    expect(template.body.split("\n").length).toBe(5);
    expect(JSON.parse(template.body)).toMatchObject({ voice: "marin" });
    expect(template.response).toMatchObject({ source: "body" });
  });

  it("defaults to GET without a body and POST with one", () => {
    expect(parseCurl("curl https://x.test/voices").method).toBe("GET");
    expect(parseCurl("curl https://x.test/tts -d 'a=1'").method).toBe("POST");
    expect(parseCurl("curl -X PUT https://x.test/tts").method).toBe("PUT");
    expect(parseCurl("curl -XPUT https://x.test/tts").method).toBe("PUT");
  });

  it("reads --header=value and --data=value written with an equals sign", () => {
    const t = parseCurl("curl --url=https://x.test/tts --header='X-Key: k' --data='{\"a\":1}'");
    expect(t.url).toBe("https://x.test/tts");
    expect(t.headers).toContainEqual({ name: "X-Key", value: "k" });
    expect(JSON.parse(t.body)).toEqual({ a: 1 });
  });

  it("joins repeated data flags and assumes a form body when no type was given", () => {
    const t = parseCurl("curl https://x.test/tts -d 'text=hi' -d 'voice=v1'");
    expect(t.body).toBe("text=hi&voice=v1");
    expect(t.headers).toContainEqual({
      name: "Content-Type",
      value: "application/x-www-form-urlencoded",
    });
  });

  it("turns --json into a body plus its two headers, and -u into Basic auth", () => {
    const json = parseCurl(`curl https://x.test/tts --json '{"a":1}'`);
    expect(json.headers).toContainEqual({ name: "Content-Type", value: "application/json" });
    expect(json.headers).toContainEqual({ name: "Accept", value: "application/json" });
    const basic = parseCurl("curl https://x.test/tts -u alice:secret");
    expect(basic.headers).toContainEqual({
      name: "Authorization",
      value: `Basic ${btoa("alice:secret")}`,
    });
  });

  it("skips flags whose value is not part of the request", () => {
    const t = parseCurl(
      "curl -o out.mp3 --max-time 30 -A agent https://x.test/tts -d 'a=1' --retry 3",
    );
    expect(t.url).toBe("https://x.test/tts");
    expect(t.body).toBe("a=1");
  });

  it("keeps the last value when a header is repeated", () => {
    const t = parseCurl("curl https://x.test -H 'X-A: 1' -H 'X-A: 2'");
    expect(t.headers).toEqual([{ name: "X-A", value: "2" }]);
  });

  it("rejects text that is not a curl command, or has no URL, or an unusable method", () => {
    expect(() => parseCurl("wget https://x.test")).toThrow(/not a curl/);
    expect(() => parseCurl("curl -H 'X: 1'")).toThrow(/no URL/);
    expect(() => parseCurl("curl -X DELETE https://x.test")).toThrow(/DELETE/);
  });
});

describe("requestSlots", () => {
  it("finds every leaf of a JSON body, nested ones by their path", () => {
    const t = parseCurl(
      `curl https://x.test/tts --json '{"req_params":{"text":"你好","speaker":"vv","audio":{"speech_rate":0}}}'`,
    );
    expect(requestSlots(t)).toEqual([
      { path: "req_params.text", sample: "你好", kind: "json" },
      { path: "req_params.speaker", sample: "vv", kind: "json" },
      { path: "req_params.audio.speech_rate", sample: "0", kind: "json" },
    ]);
  });

  it("finds the fields of a form body and the query parameters of the URL", () => {
    const t = parseCurl("curl 'https://x.test/tts?voice=v1&fmt=mp3' -d 'text=hello&speed=1'");
    expect(requestSlots(t)).toEqual([
      { path: "text", sample: "hello", kind: "form" },
      { path: "speed", sample: "1", kind: "form" },
      { path: "voice", sample: "v1", kind: "query" },
      { path: "fmt", sample: "mp3", kind: "query" },
    ]);
  });
});

describe("withGuessedPlaceholders", () => {
  it("recognises the sentence, voice and speed by the names APIs use", () => {
    const t = withGuessedPlaceholders(
      parseCurl(
        `curl https://api.openai.com/v1/audio/speech --json '{"model":"gpt-4o-mini-tts","input":"hi","voice":"marin","speed":1}'`,
      ),
    );
    // A numeric field keeps its type: its placeholder is written unquoted, so the saved body is
    // only valid JSON once rendered.
    expect(t.body).toContain('"speed": {{speed}}');
    expect(t.body).not.toContain('"{{speed}}"');
    expect(t.body).toContain('"input": "{{text}}"');
    expect(t.body).toContain('"voice": "{{voice}}"');
    expect(t.body).toContain('"model": "gpt-4o-mini-tts"');
    expect(templateProblem(t)).toBeNull();
  });

  it("reaches nested fields, as 豆包 nests them", () => {
    const t = withGuessedPlaceholders(
      parseCurl(
        `curl https://x.test/tts --json '{"req_params":{"text":"你好","speaker":"vv","audio_params":{"speech_rate":0}}}'`,
      ),
    );
    expect(t.body).toContain('"text": "{{text}}"');
    expect(t.body).toContain('"speaker": "{{voice}}"');
    expect(t.body).toContain('"speech_rate": {{speed}}');
    // Its slots stay readable even though the body is not literally valid JSON.
    expect(requestSlots(t).map((s) => s.path)).toEqual([
      "req_params.text",
      "req_params.speaker",
      "req_params.audio_params.speech_rate",
    ]);
  });

  it("substitutes a form body and a query parameter in place", () => {
    const form = withGuessedPlaceholders(
      parseCurl("curl https://x.test/tts -d 'tts_text=hello&spk_id=voice1'"),
    );
    expect(form.body).toBe("tts_text={{text}}&spk_id={{voice}}");
    const query = withGuessedPlaceholders(parseCurl("curl 'https://x.test/say?text=hi&voice=v1'"));
    expect(query.url).toBe("https://x.test/say?text={{text}}&voice={{voice}}");
    expect(templateProblem(query)).toBeNull();
  });

  it("leaves a request it cannot read alone, so the user can pick by hand", () => {
    const t = withGuessedPlaceholders(
      parseCurl(`curl https://x.test/tts --json '{"payload":"hi"}'`),
    );
    // Nothing is guessed, and the page then asks which value is the sentence.
    expect(t.body).toContain('"hi"');
    expect(templateProblem(t)).toBe("text");
  });
});

describe("putPlaceholder", () => {
  it("replaces exactly the value picked, leaving the rest as it was", () => {
    const t = parseCurl(`curl https://x.test/tts --json '{"payload":"hi","note":"keep"}'`);
    const slot = requestSlots(t).find((s) => s.path === "payload");
    if (!slot) throw new Error("no slot");
    const next = putPlaceholder(t, slot, "{{text}}");
    expect(JSON.parse(next.body)).toEqual({ payload: "{{text}}", note: "keep" });
    expect(templateProblem(next)).toBeNull();
    expect(next.url).toBe(t.url);
    expect(next.headers).toEqual(t.headers);
  });

  it("can be pointed at another value afterwards", () => {
    const first = withGuessedPlaceholders(
      parseCurl(`curl https://x.test/tts --json '{"text":"a","content":"b"}'`),
    );
    expect(first.body).toContain('"text": "{{text}}"');
    const other = requestSlots(first).find((s) => s.path === "content");
    if (!other) throw new Error("no slot");
    const moved = putPlaceholder(first, other, "{{text}}");
    expect(moved.body).toContain('"content": "{{text}}"');
  });
});
