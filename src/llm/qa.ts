import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { APICallError, type ModelMessage, streamText } from "ai";
import type { ChatTurn, ReportContext } from "../call/session.ts";
import { defaultFetch } from "../http.ts";
import { t } from "../i18n/index.ts";
import { ADDRESS_PLACEHOLDER } from "../protocol.ts";
import { type SpeechLanguage, speechLanguagePromptName } from "../voice/languages.ts";

/**
 * How the endpoint returns the brief JSON (mirrors outbrief-daemon `StructuredOutput`):
 * `json_schema` is enforced by the endpoint; `json_object` spells the schema out in the prompt, for
 * endpoints without json_schema (DeepSeek, Ollama, Claude…). In-call questions are plain text and
 * do not use it.
 */
export type StructuredOutput = "json_schema" | "json_object";

/** The user's own OpenAI-compatible endpoint (设置 → 大模型). */
export interface LlmSettings {
  /** e.g. "http://127.0.0.1:18317/v1". */
  baseUrl: string;
  apiKey: string;
  /** Provider model id, e.g. "gemini-3.8-flash". */
  model: string;
  structuredOutput: StructuredOutput;
}

export const EMPTY_LLM: LlmSettings = {
  baseUrl: "",
  apiKey: "",
  model: "",
  structuredOutput: "json_schema",
};

export function llmConfigured(llm: LlmSettings): boolean {
  return !!(llm.baseUrl.trim() && llm.apiKey.trim() && llm.model.trim());
}

export class LlmNotConfiguredError extends Error {
  override name = "LlmNotConfiguredError";

  constructor() {
    super(t().llm.notConfigured);
  }
}

export interface QaInput {
  /** What the assistant calls the user in the answer (设置 → 称呼). */
  addressName: string;
  /** The call language: answers are spoken in it. */
  language: SpeechLanguage;
  report: ReportContext;
  /** 0-based index of the segment playing when the user interrupted. */
  playedSegmentIndex: number;
  /** Earlier turns of this call, oldest first (excludes `question`). */
  history: ChatTurn[];
  question: string;
}

/** Q&A rules; `name` is what the user asked to be called (设置 → 称呼). */
function qaRules(name: string, language: SpeechLanguage): string {
  const spoken = speechLanguagePromptName(language);
  return `你是用户的私人助理，刚才在电话里向用户口头汇报一份 AI 编程 Agent 的工作汇报，用户打断你提了问题。用户希望你称呼他“${name}”；需要称呼时就用“${name}”，不要用别的称呼；简报里的 ${ADDRESS_PLACEHOLDER} 指的就是用户，回答里不要原样写出它。

回答规则：
- 只根据下面的汇报原文和简报回答。汇报里没有的信息，直接说汇报里没提到、你不清楚，可以建议用户挂断后直接问 Agent；绝不编造、不猜测。
- 如果用户不是在提问，而是在给 Agent 下指令、提意见或做决定，简短回应已经记下了，挂断后会发给 Agent；不要假装已经去执行或已经转达。
- 用${spoken}口语回答（用户用别的语言提问也用${spoken}回答），像打电话一样自然、简短：一般 1 到 4 句话，用户要求详细说时再展开。
- 不要用 markdown、列表、代码块、emoji；文件路径、命令、代码、URL 不要逐字念，换成自然说法。
- 用户已经听过的段落不必重复，除非他问到。`;
}

/** The report verbatim with its metadata (reports are capped upstream, so nothing is cut). */
function reportBlock({ source, title, cwd, content }: ReportContext): string {
  const lines = [`来源 Agent：${source}`];
  if (title) lines.push(`项目：${title}`);
  if (cwd) lines.push(`工作目录：${cwd}`);
  lines.push(`汇报原文（共 ${content.length} 字）：`, "<report>", content, "</report>");
  return lines.join("\n");
}

/** The report the call is about plus the brief the user heard, as one prompt block. */
function callContext(report: ReportContext): string {
  const brief = report.brief
    ? `简报（JSON，电话里念给用户听的就是它）：\n<brief>\n${JSON.stringify(report.brief)}\n</brief>`
    : "简报：生成失败，没有简报，只有原文。";
  return `${reportBlock(report)}\n\n${brief}`;
}

/** System instructions and conversation for one question. */
export function qaPrompt(input: QaInput): { instructions: string; messages: ModelMessage[] } {
  const segments = input.report.brief?.segments ?? [];
  const played = segments.slice(0, input.playedSegmentIndex).map((s) => `「${s.card.title}」`);
  const current = segments[input.playedSegmentIndex];
  const progress = [
    played.length ? `用户已经听完的段落：${played.join("、")}。` : "用户还没有听完任何一段。",
    current ? `正在讲「${current.card.title}」这一段时被打断。` : "",
  ].join("");
  return {
    instructions: [
      qaRules(input.addressName, input.language),
      callContext(input.report),
      progress,
    ].join("\n\n"),
    messages: [
      ...input.history.map((turn): ModelMessage => ({ role: turn.role, content: turn.text })),
      { role: "user", content: input.question },
    ],
  };
}

export function describeLlmError(err: unknown): Error {
  if (APICallError.isInstance(err)) {
    const status = err.statusCode ? `HTTP ${err.statusCode}` : t().llm.connectFailed;
    return new Error(t().llm.apiError(status, err.message), { cause: err });
  }
  if (err instanceof Error) return err;
  // The Tauri HTTP plugin rejects with plain strings (e.g. a URL outside its scope).
  return new Error(t().llm.requestFailed(String(err)), { cause: err });
}

/**
 * Streams the spoken answer to `input.question` from the user's own endpoint, grounded in the full
 * report and brief. Throws when the LLM is not configured, the request fails, the stream breaks,
 * or nothing came back; aborting `signal` ends it with an error too (callers check the signal).
 */
export async function* answerQuestion(
  llm: LlmSettings,
  input: QaInput,
  signal: AbortSignal,
  fetchImpl: typeof fetch = defaultFetch(),
): AsyncGenerator<string, void, undefined> {
  if (!llmConfigured(llm)) throw new LlmNotConfiguredError();
  const provider = createOpenAICompatible({
    name: "outbrief",
    baseURL: llm.baseUrl.trim(),
    apiKey: llm.apiKey.trim(),
    fetch: fetchImpl,
  });
  const { instructions, messages } = qaPrompt(input);
  const result = streamText({
    model: provider.chatModel(llm.model.trim()),
    instructions,
    prompt: messages,
    abortSignal: signal,
    // The call UI offers 重试; a silent retry would only delay the error.
    maxRetries: 0,
    // Errors surface as `error` parts below; the default handler would only log them.
    onError: () => undefined,
  });
  let answered = false;
  for await (const part of result.fullStream) {
    switch (part.type) {
      case "text-delta":
        if (part.text) {
          answered = true;
          yield part.text;
        }
        break;
      case "error":
        throw describeLlmError(part.error);
      case "abort":
        throw new DOMException("answer aborted", "AbortError");
      case "finish":
        if (part.finishReason === "content-filter") throw new Error(t().llm.filtered);
        if (!answered) throw new Error(t().llm.empty(part.finishReason));
        break;
    }
  }
}
