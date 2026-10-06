import { describe, expect, it } from "vitest";
import { listModels, testEndpoint } from "./endpoint.ts";
import { normalizeBaseUrl, providerOf } from "./providers.ts";
import type { LlmSettings } from "./qa.ts";

const LLM: LlmSettings = {
  baseUrl: "https://api.test/v1",
  apiKey: "sk-test",
  model: "m",
  structuredOutput: "json_schema",
};
const PROBE = JSON.stringify({
  status: "done",
  headline: "完成",
  items: [
    { id: "i1", text: "a" },
    { id: "i2", text: "b" },
  ],
});

function completion(content: string): Response {
  return Response.json({
    id: "chatcmpl-test",
    object: "chat.completion",
    created: 0,
    model: "m",
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

/** Chat-completions requests go to `respond`; records each body. */
function wire(respond: (body: Record<string, unknown>) => Response) {
  const bodies: Record<string, unknown>[] = [];
  const fetchImpl = (async (_url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    bodies.push(body);
    return respond(body);
  }) as typeof fetch;
  return { bodies, fetchImpl };
}

describe("providers", () => {
  it("recognises a preset by its base URL, anything else is custom", () => {
    expect(providerOf("https://api.deepseek.com/")).toBe("deepseek");
    expect(providerOf("https://api.x.ai/v1")).toBe("grok");
    expect(providerOf("http://127.0.0.1:8080/v1")).toBe("custom");
  });

  it("turns what the user pasted into a base URL", () => {
    expect(normalizeBaseUrl(" https://api.example.com ")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1/")).toBe("https://api.example.com/v1");
    expect(normalizeBaseUrl("https://api.example.com/v1/chat/completions")).toBe(
      "https://api.example.com/v1",
    );
    expect(normalizeBaseUrl("http://127.0.0.1:8080/v1/models")).toBe("http://127.0.0.1:8080/v1");
    expect(normalizeBaseUrl("api.example.com")).toBe("api.example.com");
  });
});

describe("listModels", () => {
  it("reads the ids of GET /models with the key, sorted and unique", async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(url), auth: new Headers(init?.headers).get("authorization") });
      return Response.json({ data: [{ id: "b" }, { id: "a" }, { id: "b" }, { nope: 1 }] });
    }) as typeof fetch;
    expect(await listModels("https://api.test/v1/", "sk-x", fetchImpl)).toEqual(["a", "b"]);
    expect(seen).toEqual([{ url: "https://api.test/v1/models", auth: "Bearer sk-x" }]);
  });

  it("fails with the status and body of a rejected call", async () => {
    const fetchImpl = (async () =>
      new Response("invalid api key", { status: 401 })) as unknown as typeof fetch;
    await expect(listModels("https://api.test/v1", "sk-x", fetchImpl)).rejects.toThrow(
      /HTTP 401.*invalid api key/,
    );
  });
});

describe("testEndpoint", () => {
  it("is ok when a schema-constrained call works, the same call the daemon makes", async () => {
    const { bodies, fetchImpl } = wire(() => completion(PROBE));
    expect(await testEndpoint(LLM, fetchImpl)).toMatchObject({ kind: "ok" });
    expect(bodies[0]?.response_format).toMatchObject({ type: "json_schema" });
  });

  it("asks OpenRouter to route json_schema only to endpoints that support it", async () => {
    const { bodies, fetchImpl } = wire(() => completion(PROBE));
    await testEndpoint({ ...LLM, baseUrl: "https://openrouter.ai/api/v1" }, fetchImpl);
    expect(bodies[0]?.provider).toEqual({ require_parameters: true });
  });

  it("tests the JSON mode strategy with the schema in the prompt and a fenced answer", async () => {
    const { bodies, fetchImpl } = wire(() => completion(`\`\`\`json\n${PROBE}\n\`\`\``));
    const result = await testEndpoint({ ...LLM, structuredOutput: "json_object" }, fetchImpl);
    expect(result).toMatchObject({ kind: "ok" });
    expect(bodies[0]?.response_format).toEqual({ type: "json_object" });
    const messages = bodies[0]?.messages as { role: string; content: string }[];
    expect(messages.find((m) => m.role === "system")?.content).toContain("JSON Schema");
  });

  it("reports JSON that does not match the schema as chat only", async () => {
    const { fetchImpl } = wire((body) =>
      body.response_format ? completion('{"status":"maybe"}') : completion("ok"),
    );
    const result = await testEndpoint({ ...LLM, structuredOutput: "json_object" }, fetchImpl);
    expect(result).toMatchObject({ kind: "chatOnly" });
  });

  it("tells an endpoint without structured output apart from a broken one", async () => {
    const { bodies, fetchImpl } = wire((body) =>
      body.response_format
        ? Response.json({ error: { message: "json_schema not supported" } }, { status: 400 })
        : completion("ok"),
    );
    const result = await testEndpoint(LLM, fetchImpl);
    expect(result).toMatchObject({ kind: "chatOnly" });
    expect(bodies).toHaveLength(2);
  });

  it("names a rejected key", async () => {
    const { fetchImpl } = wire(() =>
      Response.json({ error: { message: "bad key" } }, { status: 401 }),
    );
    const result = await testEndpoint(LLM, fetchImpl);
    expect(result.kind).toBe("failed");
    expect(result.kind === "failed" && result.error).toMatch(/API Key|API key/);
  });
});
