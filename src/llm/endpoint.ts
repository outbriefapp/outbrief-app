import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  APICallError,
  extractJsonMiddleware,
  generateText,
  type LanguageModel,
  Output,
  wrapLanguageModel,
} from "ai";
import { z } from "zod";
import { defaultFetch } from "../http.ts";
import { t } from "../i18n/index.ts";
import { describeLlmError, type LlmSettings } from "./qa.ts";

const MODELS_TIMEOUT_MS = 15_000;
const TEST_TIMEOUT_MS = 45_000;

/** `GET {baseUrl}/models`: the model ids the key can use, sorted; throws when the call fails. */
export async function listModels(
  baseUrl: string,
  apiKey: string,
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<string[]> {
  let resp: Response;
  try {
    resp = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
  } catch (err) {
    throw new Error(t().llm.requestFailed(err instanceof Error ? err.message : String(err)));
  }
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 200);
    throw new Error(t().llm.apiError(`HTTP ${resp.status}`, detail || resp.statusText));
  }
  const body = (await resp.json().catch(() => null)) as { data?: unknown } | null;
  if (!Array.isArray(body?.data)) throw new Error(t().settings.llm.modelsMalformed);
  const ids = body.data
    .map((m) => (m && typeof m === "object" ? (m as { id?: unknown }).id : undefined))
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}

/**
 * What 测试连接 found, for the chosen `structuredOutput`:
 * - `ok`: in-call questions and the daemon's briefs both work (a call shaped like a brief, with the
 *   same structured-output strategy the daemon uses, came back valid).
 * - `chatOnly`: plain chat works but the structured call failed, so briefs would fail with this
 *   strategy; `error` is why (e.g. json_schema rejected, or JSON that does not match).
 * - `failed`: nothing works; `error` says why (key, address, model).
 */
export type EndpointTest =
  | { kind: "ok"; ms: number }
  | { kind: "chatOnly"; ms: number; error: string }
  | { kind: "failed"; error: string };

/** A small brief-like shape: an enum, a nested array of objects, a plain string. */
const Probe = z.object({
  status: z.enum(["done", "failed"]),
  headline: z.string(),
  items: z.array(z.object({ id: z.string(), text: z.string() })),
});
const PROBE_PROMPT =
  "测试：假设一个任务已经完成。status 填 done，headline 写一句不超过 10 个字的结论，items 写两条，id 依次用 i1、i2。";

/**
 * The chat model for a structured call, the way outbrief-daemon builds it: json_schema is enforced
 * by the endpoint; json_object strips a markdown fence and relies on the schema in the prompt.
 */
function structuredModel(llm: LlmSettings, fetchImpl: typeof fetch): LanguageModel {
  const model = createOpenAICompatible({
    name: "outbrief",
    baseURL: llm.baseUrl.trim(),
    apiKey: llm.apiKey.trim(),
    supportsStructuredOutputs: llm.structuredOutput === "json_schema",
    fetch: fetchImpl,
  }).chatModel(llm.model.trim());
  return llm.structuredOutput === "json_schema"
    ? model
    : wrapLanguageModel({ model, middleware: extractJsonMiddleware() });
}

/**
 * Extra request fields a provider needs, as outbrief-daemon `routingOptions`: OpenRouter only routes
 * json_schema to upstream endpoints that support it when asked (`provider.require_parameters`).
 */
export function routingOptions(
  baseUrl: string,
  structuredOutput: LlmSettings["structuredOutput"],
): Record<string, { require_parameters: true }> {
  const host = URL.canParse(baseUrl) ? new URL(baseUrl).hostname : "";
  return host === "openrouter.ai" && structuredOutput === "json_schema"
    ? { provider: { require_parameters: true } }
    : {};
}

/** The schema spelled out in the prompt (json_object), as outbrief-daemon `withSchema` does. */
export function withSchema(system: string, schema: z.ZodType): string {
  const jsonSchema = JSON.stringify(
    z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }),
  );
  return `${system}

输出格式：只输出一个 JSON 对象，不要输出任何其他文字，不要用 markdown 代码块包起来。这个 JSON 必须符合下面的 JSON Schema（字段名、类型、必填项都要一致）：
${jsonSchema}`;
}

export async function testEndpoint(
  llm: LlmSettings,
  fetchImpl: typeof fetch = defaultFetch(),
): Promise<EndpointTest> {
  const model = structuredModel(llm, fetchImpl);
  const system = "你是一个测试助手。";
  const started = performance.now();
  try {
    await generateText({
      model,
      instructions: llm.structuredOutput === "json_object" ? withSchema(system, Probe) : system,
      prompt: PROBE_PROMPT,
      output: Output.object({ schema: Probe }),
      providerOptions: { outbrief: routingOptions(llm.baseUrl, llm.structuredOutput) },
      abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
      maxRetries: 0,
    });
    return { kind: "ok", ms: Math.round(performance.now() - started) };
  } catch (structuredErr) {
    // Tell "the endpoint is unusable" apart from "this strategy does not work on it".
    const structured = describeLlmError(structuredErr).message;
    const chat = createOpenAICompatible({
      name: "outbrief",
      baseURL: llm.baseUrl.trim(),
      apiKey: llm.apiKey.trim(),
      fetch: fetchImpl,
    }).chatModel(llm.model.trim());
    const plainStarted = performance.now();
    try {
      await generateText({
        model: chat,
        prompt: "只回复 ok",
        abortSignal: AbortSignal.timeout(TEST_TIMEOUT_MS),
        maxRetries: 0,
      });
      return {
        kind: "chatOnly",
        ms: Math.round(performance.now() - plainStarted),
        error: structured,
      };
    } catch (plainErr) {
      return { kind: "failed", error: failureText(plainErr) };
    }
  }
}

/** A failed call in words, naming the usual cause for the common statuses. */
function failureText(err: unknown): string {
  const m = t().settings.llm;
  const detail = describeLlmError(err).message;
  if (APICallError.isInstance(err)) {
    if (err.statusCode === 401 || err.statusCode === 403) return `${m.keyRejected}（${detail}）`;
    if (err.statusCode === 404) return `${m.notFound}（${detail}）`;
  }
  return detail;
}
