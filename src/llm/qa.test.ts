import { describe, expect, it } from "vitest";
import type { ReportContext } from "../call/session.ts";
import type { Brief } from "../protocol.ts";
import {
  answerQuestion,
  LlmNotConfiguredError,
  type LlmSettings,
  type QaInput,
  qaPrompt,
} from "./qa.ts";

const LLM: LlmSettings = {
  baseUrl: "http://127.0.0.1:18317/v1",
  apiKey: "sk-test",
  model: "gemini-3.8-flash",
  structuredOutput: "json_schema",
};

const brief: Brief = {
  verdict: { status: "done", headline: "登录修好了" },
  facts: [],
  segments: [
    {
      id: "s1",
      speech: "{称呼}，登录修好了",
      card: { title: "结论", bullets: [] },
      coveredFactIds: [],
    },
    { id: "s2", speech: "还有一个问题", card: { title: "待定", bullets: [] }, coveredFactIds: [] },
  ],
  decisions: [],
};

const report: ReportContext = {
  source: "multica",
  title: "修登录",
  cwd: "/work/app",
  content: `${"开头".padEnd(100_000, "中")}结尾`,
  brief,
};

const input: QaInput = {
  addressName: "李哥",
  language: "zh-CN",
  report,
  playedSegmentIndex: 1,
  history: [
    { role: "user", text: "为什么" },
    { role: "assistant", text: "因为旧代码有 bug" },
  ],
  question: "测试跑了吗",
};

/** A fake OpenAI-compatible wire: records requests and answers with the given SSE chunks. */
function fakeWire(respond: () => Response) {
  const requests: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      auth: new Headers(init?.headers).get("authorization"),
    });
    return respond();
  }) as typeof fetch;
  return { fetchImpl, requests };
}

function sse(...deltas: string[]): Response {
  const lines = deltas.map(
    (content) =>
      `data: ${JSON.stringify({ id: "c1", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`,
  );
  lines.push(
    `data: ${JSON.stringify({ id: "c1", created: 0, model: "m", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`,
    "data: [DONE]\n\n",
  );
  return new Response(lines.join(""), { headers: { "Content-Type": "text/event-stream" } });
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const chunk of gen) out.push(chunk);
  return out;
}

describe("qaPrompt", () => {
  it("sends the full report verbatim with its metadata, the brief, progress and the 称呼", () => {
    const { instructions, messages } = qaPrompt(input);
    expect(instructions).toContain("称呼他“李哥”");
    expect(instructions).toContain("挂断后会发给 Agent");
    expect(instructions).toContain(
      `来源 Agent：multica\n项目：修登录\n工作目录：/work/app\n汇报原文（共 ${report.content.length} 字）：\n<report>\n${report.content}\n</report>`,
    );
    expect(instructions).toContain(`<brief>\n${JSON.stringify(brief)}\n</brief>`);
    expect(instructions).toContain("用户已经听完的段落：「结论」。正在讲「待定」这一段时被打断。");
    expect(messages).toEqual([
      { role: "user", content: "为什么" },
      { role: "assistant", content: "因为旧代码有 bug" },
      { role: "user", content: "测试跑了吗" },
    ]);
  });

  it("answers in the call language", () => {
    expect(qaPrompt(input).instructions).toContain("用中文（简体，中国）口语回答");
    const { instructions } = qaPrompt({ ...input, language: "ja-JP" });
    expect(instructions).toContain(
      "用日语（日本）口语回答（用户用别的语言提问也用日语（日本）回答）",
    );
    expect(instructions).not.toContain("用中文口语");
  });

  it("says so when there is no brief and nothing was heard yet", () => {
    const { instructions } = qaPrompt({
      ...input,
      report: { ...report, brief: null },
      playedSegmentIndex: 0,
    });
    expect(instructions).toContain("简报：生成失败，没有简报，只有原文。");
    expect(instructions).toContain("用户还没有听完任何一段。");
  });
});

describe("answerQuestion", () => {
  it("streams the answer chunks from the configured endpoint and model", async () => {
    const wire = fakeWire(() => sse("跑了，", "全过。"));
    const chunks = await collect(
      answerQuestion(LLM, input, new AbortController().signal, wire.fetchImpl),
    );
    expect(chunks.join("")).toBe("跑了，全过。");
    expect(wire.requests).toHaveLength(1);
    const [req] = wire.requests;
    expect(req?.url).toBe("http://127.0.0.1:18317/v1/chat/completions");
    expect(req?.auth).toBe("Bearer sk-test");
    expect(req?.body).toMatchObject({ model: "gemini-3.8-flash", stream: true });
    const sent = req?.body.messages as { role: string; content: string }[];
    expect(sent[0]?.role).toBe("system");
    expect(sent.at(-1)).toEqual({ role: "user", content: "测试跑了吗" });
  });

  it("refuses to call anything until the LLM is configured", async () => {
    const wire = fakeWire(() => sse("x"));
    for (const llm of [
      { ...LLM, baseUrl: " " },
      { ...LLM, apiKey: "" },
      { ...LLM, model: "" },
    ]) {
      await expect(
        collect(answerQuestion(llm, input, new AbortController().signal, wire.fetchImpl)),
      ).rejects.toBeInstanceOf(LlmNotConfiguredError);
    }
    expect(wire.requests).toHaveLength(0);
  });

  it("throws the endpoint's HTTP error instead of an empty answer", async () => {
    const wire = fakeWire(
      () =>
        new Response(JSON.stringify({ error: { message: "invalid api key" } }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
    );
    await expect(
      collect(answerQuestion(LLM, input, new AbortController().signal, wire.fetchImpl)),
    ).rejects.toThrow(/HTTP 401/);
    expect(wire.requests).toHaveLength(1);
  });

  it("throws when the stream finishes without text", async () => {
    const wire = fakeWire(() => sse());
    await expect(
      collect(answerQuestion(LLM, input, new AbortController().signal, wire.fetchImpl)),
    ).rejects.toThrow(/没有返回内容/);
  });

  it("stops with an error when aborted", async () => {
    const ctrl = new AbortController();
    const wire = fakeWire(() => sse("一", "二"));
    const gen = answerQuestion(LLM, input, ctrl.signal, wire.fetchImpl);
    ctrl.abort();
    await expect(collect(gen)).rejects.toThrow();
  });
});
