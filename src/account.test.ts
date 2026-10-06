import { afterEach, describe, expect, it, vi } from "vitest";
import { createOwnAccount, joinThroughLocalDaemon, joinWithInvite } from "./account.ts";

const SESSION = {
  accountId: "acc-1",
  device: {
    id: "dev-1",
    name: "Mac App",
    kind: "app",
    online: false,
    createdAt: "2026-09-29T00:00:00.000Z",
    lastSeenAt: null,
    current: true,
  },
  token: "oba_new",
};
const KEY = "obk1_Lx4pmWArsLrCqKgNPE7sIYbZh5EQ66DRTMvbmmmmsQY";

afterEach(() => vi.unstubAllGlobals());

function fakeServer(routes: Record<string, unknown>) {
  const calls: { url: string; body: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url: String(url), body });
      const answer = routes[String(url)];
      return answer === undefined
        ? Response.json({ error: "not_found" }, { status: 404 })
        : Response.json(answer, { status: 201 });
    }),
  );
  return calls;
}

describe("accounts", () => {
  it("creates an account with a new random key when this device has none", async () => {
    const calls = fakeServer({ "http://localhost:8787/v1/accounts": SESSION });
    const patch = await createOwnAccount("http://localhost:8787", "");
    expect(patch).toMatchObject({
      serverUrl: "http://localhost:8787",
      token: "oba_new",
      accountId: "acc-1",
      deviceId: "dev-1",
      e2eFromDaemon: false,
    });
    expect(patch.e2eKey).toMatch(/^obk1_/);
    expect(calls[0]?.body).toMatchObject({ device: { kind: "app" } });
    // A key this device already has is kept.
    expect((await createOwnAccount("http://localhost:8787", KEY)).e2eKey).toBe(KEY);
  });

  it("joins with a pairing link: its server and its key", async () => {
    const calls = fakeServer({ "https://cloud.test/v1/pairing/redeem": SESSION });
    const link = `outbrief://pair?server=https%3A%2F%2Fcloud.test&code=123456&key=${KEY}`;
    const { parsePairingInput } = await import("./pairing.ts");
    const invite = parsePairingInput(link);
    if (!invite) throw new Error("link not parsed");
    const patch = await joinWithInvite("http://localhost:8787", invite, "", "");
    expect(patch).toMatchObject({ serverUrl: "https://cloud.test", e2eKey: KEY });
    expect(calls[0]?.body).toMatchObject({ code: "123456" });
  });

  it("derives the key from the passphrase when only the digits were typed", async () => {
    fakeServer({ "http://localhost:8787/v1/pairing/redeem": SESSION });
    const patch = await joinWithInvite(
      "http://localhost:8787",
      { code: "123456" },
      "correct horse battery",
      "",
    );
    // The same vector outbrief-daemon's tests derive from this passphrase.
    expect(patch.e2eKey).toBe(KEY);
  });

  it("joins the local daemon's account with the code and key it hands out", async () => {
    const calls = fakeServer({
      "http://127.0.0.1:8790/local/pairing": {
        serverUrl: "http://localhost:8787",
        code: "654321",
        key: KEY,
        expiresAt: "2026-09-29T00:10:00.000Z",
        link: "outbrief://pair?…",
      },
      "http://localhost:8787/v1/pairing/redeem": SESSION,
    });
    const patch = await joinThroughLocalDaemon({ kind: "local", localKey: "obl_local" });
    expect(patch).toMatchObject({ token: "oba_new", e2eKey: KEY, e2eFromDaemon: true });
    expect(calls.map((c) => c.url)).toEqual([
      "http://127.0.0.1:8790/local/pairing",
      "http://localhost:8787/v1/pairing/redeem",
    ]);
  });
});
