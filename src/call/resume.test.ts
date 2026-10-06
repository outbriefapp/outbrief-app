import { describe, expect, it } from "vitest";
import { resumeCommand } from "./resume.ts";

describe("resumeCommand", () => {
  it("resumes a Claude Code session inside its working directory", () => {
    expect(resumeCommand({ source: "claude-code", sessionId: "abc-123", cwd: "/work/app" })).toBe(
      "cd /work/app && claude --resume abc-123",
    );
  });

  it("omits cd when the working directory is unknown", () => {
    expect(resumeCommand({ source: "claude-code", sessionId: "abc-123" })).toBe(
      "claude --resume abc-123",
    );
    expect(resumeCommand({ source: "codex", sessionId: "s1" })).toBe("codex resume s1");
  });

  it("prefixes cd for Codex when the working directory is known", () => {
    expect(resumeCommand({ source: "codex", sessionId: "s1", cwd: "/repo" })).toBe(
      "cd /repo && codex resume s1",
    );
  });

  it("single-quotes paths with spaces or shell metacharacters, escaping embedded quotes", () => {
    expect(resumeCommand({ source: "claude-code", sessionId: "s", cwd: "/My Projects/app" })).toBe(
      "cd '/My Projects/app' && claude --resume s",
    );
    expect(resumeCommand({ source: "codex", sessionId: "s", cwd: "/tmp/it's$(x)" })).toBe(
      "cd '/tmp/it'\\''s$(x)' && codex resume s",
    );
    expect(resumeCommand({ source: "codex", sessionId: "a;rm -rf ~" })).toBe(
      "codex resume 'a;rm -rf ~'",
    );
  });

  it("returns null for sources without a resume command or without a session id", () => {
    expect(resumeCommand({ source: "generic", sessionId: "s", cwd: "/repo" })).toBeNull();
    expect(resumeCommand({ source: "gemini-cli", sessionId: "s" })).toBeNull();
    expect(resumeCommand({ source: "claude-code", cwd: "/repo" })).toBeNull();
    expect(resumeCommand({ source: "codex", sessionId: "" })).toBeNull();
  });
});
