import { describe, expect, it } from "vitest";
import { deviceName, pairingLink, parsePairingInput } from "./pairing.ts";

describe("pairing input", () => {
  const invite = {
    serverUrl: "https://outbrief.example.com:8443",
    code: "042917",
    key: "obk1_Lx4pmWArsLrCqKgNPE7sIYbZh5EQ66DRTMvbmmmmsQY",
  };

  it("round-trips a pairing link with the server address, the code and the key", () => {
    const link = pairingLink(invite);
    expect(link).toMatch(/^outbrief:\/\/pair\?/);
    expect(parsePairingInput(link)).toEqual(invite);
    expect(parsePairingInput(`  ${link}\n`)).toEqual(invite);
  });

  it("reads the link outbrief-daemon prints", () => {
    const fromDaemon =
      "outbrief://pair?server=http%3A%2F%2F127.0.0.1%3A8787&code=123456&key=obk1_Lx4pmWArsLrCqKgNPE7sIYbZh5EQ66DRTMvbmmmmsQY";
    expect(parsePairingInput(fromDaemon)).toEqual({
      serverUrl: "http://127.0.0.1:8787",
      code: "123456",
      key: invite.key,
    });
  });

  it("takes 6 typed digits, spaces allowed, with no server or key", () => {
    expect(parsePairingInput("042 917")).toEqual({ code: "042917" });
    expect(parsePairingInput("04291")).toBeUndefined();
    expect(parsePairingInput("https://evil.test/?code=042917")).toBeUndefined();
    expect(parsePairingInput("outbrief://pair?code=12&server=https://a.test")).toBeUndefined();
  });
});

describe("deviceName", () => {
  it("names the platform and whether it is the app or a browser", () => {
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15";
    expect(deviceName(iphone, false)).toBe("iPhone Browser");
    expect(deviceName(iphone, true)).toBe("iPhone App");
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15";
    expect(deviceName(mac, true)).toBe("Mac App");
    expect(deviceName("Mozilla/5.0 (Linux; Android 15; Pixel 9)", false)).toBe("Android Browser");
  });
});
