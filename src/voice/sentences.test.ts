import { describe, expect, it } from "vitest";
import { SentenceChunker, splitSentences } from "./sentences.ts";

describe("splitSentences", () => {
  it("splits Chinese and English sentences, keeping punctuation", () => {
    expect(
      splitSentences("任务已经完成了。测试全部通过！还有问题吗？Build passed. Deploy next!"),
    ).toEqual([
      "任务已经完成了。",
      "测试全部通过！",
      "还有问题吗？",
      "Build passed.",
      "Deploy next!",
    ]);
  });

  it("does not split decimals, file names or abbreviations followed by punctuation", () => {
    expect(splitSentences("版本升级到 3.5 了，修改了 a.ts 和 b.test.ts 两个文件。")).toEqual([
      "版本升级到 3.5 了，修改了 a.ts 和 b.test.ts 两个文件。",
    ]);
    expect(splitSentences("Coverage is 97.5 percent now. Node.js works too.")).toEqual([
      "Coverage is 97.5 percent now.",
      "Node.js works too.",
    ]);
  });

  it("keeps terminator runs and closing quotes together", () => {
    expect(splitSentences("真的吗？！他说：“已经修好了。”那就好……我们继续吧。")).toEqual([
      "真的吗？！他说：“已经修好了。”",
      "那就好……我们继续吧。",
    ]);
  });

  it("splits at newlines and drops blank lines", () => {
    expect(splitSentences("第一行没有句号\n\n第二行也没有句号\n")).toEqual([
      "第一行没有句号",
      "第二行也没有句号",
    ]);
  });

  it("merges fragments shorter than 6 characters into the next sentence, or the previous at the end", () => {
    expect(splitSentences("好的。我来总结一下结果。嗯。")).toEqual([
      "好的。我来总结一下结果。嗯。",
    ]);
    expect(splitSentences("OK. Here is the summary.")).toEqual(["OK. Here is the summary."]);
    expect(splitSentences("好。")).toEqual(["好。"]);
  });

  it("splits sentences over 120 characters at commas", () => {
    const clause = "这是一个比较长的分句用来测试切分逻辑是否正确"; // 22 chars
    const text = `${Array.from({ length: 8 }, () => clause).join("，")}。`;
    const parts = splitSentences(text);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 120)).toBe(true);
    expect(parts.slice(0, -1).every((p) => p.endsWith("，"))).toBe(true);
    expect(parts.join("")).toBe(text);
  });

  it("hard-splits a long run without any comma", () => {
    const parts = splitSentences("字".repeat(250));
    expect(parts.map((p) => p.length)).toEqual([120, 120, 10]);
  });

  it("does not treat the thousands separator as a clause break", () => {
    const text = `${"a".repeat(110)} 1,000 items and more words`;
    expect(splitSentences(text)).toEqual([text.slice(0, 120), text.slice(120)]);
  });
});

describe("SentenceChunker", () => {
  it("emits sentences as soon as they are complete across chunk boundaries", () => {
    const c = new SentenceChunker();
    expect(c.push("任务已经")).toEqual([]);
    expect(c.push("完成了。")).toEqual([]); // the terminator run may continue ("。」")
    expect(c.push("测试全部通过！还")).toEqual(["任务已经完成了。", "测试全部通过！"]);
    expect(c.push("有问题吗")).toEqual([]);
    expect(c.flush()).toEqual(["还有问题吗"]);
    expect(c.flush()).toEqual([]);
  });

  it("waits for the next chunk before splitting at an ASCII period", () => {
    const c = new SentenceChunker();
    expect(c.push("Version 3.")).toEqual([]);
    expect(c.push("5 is out. Next")).toEqual(["Version 3.5 is out."]);
    expect(c.flush()).toEqual(["Next"]);
  });

  it("holds a short fragment back and merges it into the following sentence", () => {
    const c = new SentenceChunker();
    expect(c.push("好的。")).toEqual([]);
    expect(c.push("我")).toEqual([]);
    expect(c.push("来总结一下。然后")).toEqual(["好的。我来总结一下。"]);
    expect(c.flush()).toEqual(["然后"]);
  });

  it("speaks a long comma run before its terminator arrives", () => {
    const c = new SentenceChunker();
    const clause = "这是一个比较长的分句用来测试切分逻辑是否正确，";
    const emitted = c.push(clause.repeat(8));
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted.every((s) => s.length <= 120 && s.endsWith("，"))).toBe(true);
    expect([...emitted, ...c.flush()].join("")).toBe(clause.repeat(8));
  });

  it("matches splitSentences when fed character by character", () => {
    const text = "好的。任务已经完成了，版本 3.5 发布。Tests pass. 下一步呢？\n继续吧";
    const c = new SentenceChunker();
    const streamed = [...text].flatMap((ch) => c.push(ch));
    expect([...streamed, ...c.flush()]).toEqual(splitSentences(text));
  });
});
