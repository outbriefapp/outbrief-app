import { afterEach, describe, expect, it, vi } from "vitest";
import { AzureTokenProvider } from "./azureToken.ts";

const jwt = (expSeconds: number) => `h.${btoa(JSON.stringify({ exp: expSeconds }))}.s`;
const skew = () => Response.json({ error: { code: 401001, message: "time" } }, { status: 401 });

/** Stubs fetch with `handler`, recording each endpoint request's X-MT-Signature date. */
function stub(handler: (url: string, call: number) => Response) {
  const signatureDates: string[] = [];
  let call = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const signature = new Headers(init?.headers).get("X-MT-Signature");
      if (signature) {
        signatureDates.push(signature.split("::")[2] ?? "");
        expect(init?.referrerPolicy).toBe("no-referrer");
      }
      return handler(url, ++call);
    }),
  );
  return signatureDates;
}

describe("AzureTokenProvider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("caches the token until 3 minutes before exp, sharing one in-flight fetch", async () => {
    const now = Date.now();
    const exp = Math.floor(now / 1000) + 600;
    const dates = stub(() => Response.json({ r: "eastasia", t: jwt(exp) }));
    const tokens = new AzureTokenProvider();
    const [a, b] = await Promise.all([tokens.get(), tokens.get()]);
    expect(a).toEqual({ region: "eastasia", token: jwt(exp) });
    expect(b).toBe(a);
    vi.spyOn(Date, "now").mockReturnValue(exp * 1000 - 181_000);
    expect(await tokens.get()).toBe(a);
    vi.spyOn(Date, "now").mockReturnValue(exp * 1000 - 179_000);
    await tokens.get();
    expect(dates).toHaveLength(2);
  });

  it("re-signs with the server's Date header after a clock-skew rejection and keeps the offset", async () => {
    const serverDate = "Fri, 25 Sep 2026 06:22:53 GMT";
    const dates = stub((_url, call) =>
      call === 1
        ? new Response(skew().body, { status: 401, headers: { Date: serverDate } })
        : Response.json({ r: "eastasia", t: jwt(Date.parse(serverDate) / 1000 + 60) }),
    );
    const tokens = new AzureTokenProvider();
    await tokens.get();
    expect(dates[1]).toBe("fri, 25 sep 2026 06:22:53 GMT");
    await tokens.get(); // token is already near expiry → refetch, signed with the learned offset
    expect(dates[2]?.startsWith("fri, 25 sep 2026 06:22")).toBe(true);
  });

  it("falls back to the server-time URL when the Date header is not readable", async () => {
    const epochMillis = Date.parse("2030-01-01T00:00:00Z");
    const dates = stub((url, call) => {
      if (url.startsWith("https://yd.transduck.com/")) return Response.json({ epochMillis });
      return call === 1 ? skew() : Response.json({ r: "eastasia", t: jwt(epochMillis / 1000) });
    });
    await new AzureTokenProvider().get();
    expect(dates[1]).toBe("tue, 01 jan 2030 00:00:00 GMT");
  });

  it("surfaces non-skew endpoint failures with their status", async () => {
    stub(() => new Response("blocked", { status: 403 }));
    await expect(new AzureTokenProvider().get()).rejects.toMatchObject({ status: 403 });
  });
});
