import { afterEach, describe, expect, it, vi } from "vitest";
import { daemonCall, fetchMulticaSettings, saveDaemonLlm } from "./daemonLink.ts";
import {
  type E2eKey,
  importKey,
  openJson,
  parseKeyText,
  randomKeyText,
  sealJson,
  settingsAad,
  settingsResultAad,
} from "./e2e/crypto.ts";
import { ServerError } from "./serverClient.ts";

const SERVER = { serverUrl: "https://outbrief.test", token: "oba_phone" };
const MACHINE = { id: "m1", name: "mac-mini" };

async function newKey(): Promise<E2eKey> {
  const raw = parseKeyText(randomKeyText());
  if (!raw) throw new Error("bad key");
  return importKey(raw);
}

afterEach(() => vi.unstubAllGlobals());

/**
 * Stands in for the server and the daemon behind it: opens the relayed request with the daemon's
 * key, answers with `answer(request)`, sealed the same way the daemon seals it.
 */
function fakeRelay(
  daemonKey: E2eKey,
  answer: (request: { method: string; path: string; body?: unknown }) => unknown,
) {
  const seen: { url: string; auth: string | null; request: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL, init: RequestInit) => {
      const { requestId, sealed } = JSON.parse(String(init.body)) as {
        requestId: string;
        sealed: string;
      };
      // Like the daemon: a request it cannot open is answered with no content.
      const request = (await openJson(daemonKey, settingsAad(requestId), sealed).catch(
        () => null,
      )) as { method: string; path: string } | null;
      seen.push({
        url: String(url),
        auth: new Headers(init.headers).get("Authorization"),
        request,
      });
      const result = await sealJson(
        daemonKey,
        settingsResultAad(requestId),
        request ? answer(request) : { status: 400, body: { error: "undecryptable_request" } },
      );
      return Response.json({ sealed: result });
    }),
  );
  return seen;
}

describe("settings relayed through the server", () => {
  it("seals the request with the end-to-end key and opens the daemon's answer", async () => {
    const key = await newKey();
    const seen = fakeRelay(key, () => ({
      status: 200,
      body: { settings: null, status: { configured: false, connected: false, error: null } },
    }));
    const link = { kind: "relay" as const, server: SERVER, machine: MACHINE, key };

    const answer = await fetchMulticaSettings(link);
    expect(answer.settings).toBeNull();
    expect(seen).toEqual([
      {
        url: "https://outbrief.test/v1/devices/m1/settings",
        auth: "Bearer oba_phone",
        request: { method: "GET", path: "/multica/settings" },
      },
    ]);
  });

  it("turns the daemon's refusal into the same error as a local call", async () => {
    const key = await newKey();
    fakeRelay(key, () => ({ status: 422, body: { error: "llm_key_required" } }));
    const link = { kind: "relay" as const, server: SERVER, machine: MACHINE, key };
    const err = await saveDaemonLlm(link, {
      baseUrl: "https://api.test/v1",
      apiKey: "",
      model: "m",
      structuredOutput: "json_schema",
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect(err).toMatchObject({ status: 422, code: "llm_key_required" });
  });

  it("says so when the computer is offline or holds another key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "machine_offline" }, { status: 409 })),
    );
    const link = { kind: "relay" as const, server: SERVER, machine: MACHINE, key: await newKey() };
    await expect(daemonCall(link, "GET", "/llm/settings")).rejects.toMatchObject({
      status: null,
      code: "machine_offline",
    });

    fakeRelay(await newKey(), () => ({ status: 200 }));
    await expect(daemonCall(link, "GET", "/llm/settings")).rejects.toMatchObject({
      code: "undecryptable_request",
    });
  });
});

describe("the daemon on this machine", () => {
  it("is called on 127.0.0.1 with the key from its local key file", async () => {
    const calls: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: URL, init: RequestInit) => {
        calls.push({ url: String(url), auth: new Headers(init.headers).get("Authorization") });
        return new Response(null, { status: 204 });
      }),
    );
    await daemonCall({ kind: "local", localKey: "obl_local" }, "DELETE", "/multica/settings");
    expect(calls).toEqual([
      { url: "http://127.0.0.1:8790/multica/settings", auth: "Bearer obl_local" },
    ]);
  });
});
