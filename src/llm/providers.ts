import type { StructuredOutput } from "./qa.ts";

/**
 * Well-known OpenAI-compatible endpoints for 设置 → 大模型. Picking one fills its base URL; the
 * user only brings a key and picks a model. Any other OpenAI-compatible address, including a
 * self-hosted service, is `custom`. Calls go through the AI SDK's OpenAI-compatible provider, so
 * the protocol is the same for all of them.
 */
export interface LlmProvider {
  id: string;
  /** Shown on the chip; product names are not translated. */
  name: string;
  /** Empty for `custom`. */
  baseUrl: string;
  /** Built-in model ids, newest / recommended first; the first is picked with the provider. */
  models: readonly string[];
  /** The strategy picked with the provider; the user can switch and check it with 测试连接. */
  structuredOutput: StructuredOutput;
}

export const CUSTOM_PROVIDER = "custom";

/**
 * Model ids and structured-output support as documented by each provider (checked 2026-09-29).
 * `models` is a hand-picked shortlist (flagship plus the cheap/fast tier), not the catalogue: every
 * model a key can use comes from the endpoint's `GET /models` in the picker.
 * `json_object` is the default where json_schema is not documented: DeepSeek and Zhipu list only
 * json_object, Claude's OpenAI compatibility ignores `response_format`. SiliconFlow does not say
 * which models take json_schema, so it defaults to json_object as well.
 */
export const LLM_PROVIDERS: readonly LlmProvider[] = [
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-6-luna", "gpt-6-sol", "gpt-6-astra", "gpt-5.6-luna"],
    structuredOutput: "json_schema",
  },
  {
    id: "claude",
    name: "Claude",
    baseUrl: "https://api.anthropic.com/v1",
    models: [
      "claude-haiku-4-5-20251001",
      "claude-sonnet-5-5",
      "claude-opus-5-5",
      "claude-fable-5-1",
    ],
    structuredOutput: "json_object",
  },
  {
    id: "grok",
    name: "Grok",
    baseUrl: "https://api.x.ai/v1",
    models: ["grok-4.7", "grok-4.6", "grok-4.3", "grok-4.20-0309-non-reasoning"],
    structuredOutput: "json_schema",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    models: ["deepseek-flash", "deepseek-v4-pro"],
    structuredOutput: "json_object",
  },
  {
    id: "gemini",
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      "gemini-3.8-flash",
      "gemini-3.7-flash",
      "gemini-3.5-flash-lite",
      "gemini-3.1-pro-preview",
    ],
    structuredOutput: "json_schema",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    models: [
      "google/gemini-3.8-flash",
      "deepseek/deepseek-v4.1-flash",
      "openai/gpt-6-luna",
      "anthropic/claude-sonnet-5.5",
      "x-ai/grok-4.7",
      "qwen/qwen3.8-flash",
    ],
    structuredOutput: "json_schema",
  },
  {
    id: "dashscope",
    name: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.8-flash", "qwen3.8-max", "qwen3.7-plus"],
    structuredOutput: "json_schema",
  },
  {
    id: "volcengine",
    name: "豆包",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    models: [
      "doubao-seed-2-1-lite-260915",
      "doubao-seed-2-1-pro-260915",
      "doubao-seed-2-1-turbo-260628",
    ],
    structuredOutput: "json_schema",
  },
  {
    id: "moonshot",
    name: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-k3", "kimi-k2.6"],
    structuredOutput: "json_schema",
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["glm-5.3-flash", "glm-5.3", "glm-5.2", "glm-4.7-flash"],
    structuredOutput: "json_object",
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: [
      "deepseek-ai/DeepSeek-V4-Flash",
      "Pro/zai-org/GLM-5.2",
      "Pro/moonshotai/Kimi-K2.6",
      "Qwen/Qwen3.6-27B",
    ],
    structuredOutput: "json_object",
  },
  {
    id: "vercel",
    name: "Vercel",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    models: [
      "google/gemini-3.8-flash",
      "openai/gpt-6-luna",
      "anthropic/claude-sonnet-5.5",
      "deepseek/deepseek-v4.1-flash",
      "moonshotai/kimi-k3",
      "zai/glm-5.3",
    ],
    structuredOutput: "json_schema",
  },
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://localhost:11434/v1",
    // Whatever is pulled locally; the list comes from GET /models.
    models: [],
    structuredOutput: "json_schema",
  },
];

/** The preset a base URL belongs to, `custom` for any other address. */
export function providerOf(baseUrl: string): string {
  const url = trimSlash(baseUrl.trim());
  return LLM_PROVIDERS.find((p) => p.baseUrl === url)?.id ?? CUSTOM_PROVIDER;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * What the user typed into 接口地址, as the base URL the SDK wants: a pasted
 * `…/chat/completions` or `…/models` is cut back to the base, and a bare domain (OpenAI-compatible
 * services serve everything under `/v1`) gets `/v1`. Anything that is not an http(s) URL is
 * returned trimmed, for the form to reject.
 */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim();
  if (!/^https?:\/\/[^/]/i.test(raw) || !URL.canParse(raw)) return raw;
  const url = new URL(raw);
  const path = trimSlash(url.pathname.replace(/\/(chat\/completions|completions|models)\/?$/, ""));
  return `${url.origin}${path || "/v1"}`;
}
