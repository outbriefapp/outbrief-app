import { describe, expect, it } from "vitest";
import { type CallServiceStatus, shownStatus } from "./callService.ts";

const service = (connected: boolean): CallServiceStatus => ({
  notifications: "granted",
  fullScreen: true,
  popUp: true,
  unrestricted: true,
  connected,
});

describe("shownStatus", () => {
  it("shows connected while the page reconnects and the service's stream is open", () => {
    expect(shownStatus("connecting", service(true))).toBe("online");
    expect(shownStatus("offline", service(true))).toBe("online");
  });

  it("shows the page's status when the service is not connected or not there", () => {
    expect(shownStatus("offline", service(false))).toBe("offline");
    expect(shownStatus("connecting", null)).toBe("connecting");
    expect(shownStatus("online", service(false))).toBe("online");
  });

  it("never hides a removed device", () => {
    expect(shownStatus("unauthorized", service(true))).toBe("unauthorized");
  });
});
