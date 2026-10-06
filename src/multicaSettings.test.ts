import { describe, expect, it } from "vitest";
import { multicaErrorText, multicaStatusText } from "./multicaSettings.ts";
import { ServerError } from "./serverClient.ts";

describe("multicaStatusText", () => {
  it("says what the saved connection is doing", () => {
    expect(multicaStatusText({ configured: false, connected: false, error: null })).toBe("未设置");
    expect(multicaStatusText({ configured: true, connected: false, error: null })).toBe(
      "正在连接…",
    );
    expect(multicaStatusText({ configured: true, connected: true, error: null })).toBe(
      "已连接，任务完成后会来电",
    );
    expect(
      multicaStatusText({ configured: true, connected: false, error: "Multica 拒绝连接：bad" }),
    ).toBe("Multica 拒绝连接：bad");
  });
});

describe("multicaErrorText", () => {
  it("explains the server's Multica error codes and keeps other messages", () => {
    const invalid = new ServerError("/v1/multica/settings 失败：HTTP 422", 422, {
      code: "invalid_multica_token",
    });
    expect(multicaErrorText(invalid)).toContain("Multica 拒绝了这个令牌");
    const workspace = new ServerError("x", 422, { code: "workspace_not_found" });
    expect(multicaErrorText(workspace)).toBe("这个令牌访问不到所选工作区");
    expect(multicaErrorText(new ServerError("无法连接服务器：boom", null))).toContain(
      "连不上本机的 outbrief-daemon",
    );
    expect(multicaErrorText(new ServerError("HTTP 500", 500))).toBe("HTTP 500");
  });
});
