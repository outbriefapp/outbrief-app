import { describe, expect, it } from "vitest";
import {
  formatKey,
  importKey,
  keyFromPassphrase,
  openJson,
  openText,
  parseKeyText,
  REPORT_AAD,
  replyAad,
  SealedOpenError,
  sealJson,
  sealText,
} from "./crypto.ts";

/** Shared with outbrief-daemon `src/e2e/crypto.test.ts`: both sides must agree on every byte. */
const VECTORS = {
  key: "obk1_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8",
  keyId: "5d79c9d9b9140ece",
  iv: Uint8Array.from({ length: 12 }, (_, i) => 0xa0 + i),
  aad: "outbrief:report:v1",
  plaintext: '{"content":"登录页重构完成"}',
  sealed:
    "ob1.5d79c9d9b9140ece.oKGio6Slpqeoqaqr.nTofQiu_Z9EWR73x4ON7O805sLEnXsXhepCiY9Enk4lCVDr-yNLJzPctOtxe0wbxrpaq",
  passphrase: "correct horse battery",
  passphraseKey: "obk1_Lx4pmWArsLrCqKgNPE7sIYbZh5EQ66DRTMvbmmmmsQY",
};

async function vectorKey() {
  const raw = parseKeyText(VECTORS.key);
  if (!raw) throw new Error("vector key does not parse");
  return importKey(raw);
}

async function reason(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
    return "opened";
  } catch (err) {
    return err instanceof SealedOpenError ? err.reason : "other";
  }
}

describe("e2e crypto", () => {
  it("matches the daemon's test vectors", async () => {
    const key = await vectorKey();
    expect(key.id).toBe(VECTORS.keyId);
    expect(formatKey(key)).toBe(VECTORS.key);
    expect(await sealText(key, VECTORS.aad, VECTORS.plaintext, VECTORS.iv)).toBe(VECTORS.sealed);
    expect(await openText(key, VECTORS.aad, VECTORS.sealed)).toBe(VECTORS.plaintext);
    const fromPassphrase = await importKey(await keyFromPassphrase(VECTORS.passphrase));
    expect(formatKey(fromPassphrase)).toBe(VECTORS.passphraseKey);
  });

  it("round-trips JSON with a fresh IV each time", async () => {
    const key = await importKey(crypto.getRandomValues(new Uint8Array(32)));
    const a = await sealJson(key, REPORT_AAD, { content: "done" });
    expect(a).not.toBe(await sealJson(key, REPORT_AAD, { content: "done" }));
    expect(await openJson(key, REPORT_AAD, a)).toEqual({ content: "done" });
  });

  it("refuses the wrong key, another purpose, tampering and plaintext", async () => {
    const key = await vectorKey();
    const other = await importKey(crypto.getRandomValues(new Uint8Array(32)));
    expect(await reason(() => openText(other, VECTORS.aad, VECTORS.sealed))).toBe("wrong_key");
    expect(await reason(() => openText(key, replyAad("e1"), VECTORS.sealed))).toBe("tampered");
    const flipped = `${VECTORS.sealed.slice(0, -2)}${VECTORS.sealed.endsWith("aa") ? "ab" : "aa"}`;
    expect(await reason(() => openText(key, VECTORS.aad, flipped))).toBe("tampered");
    expect(await reason(() => openText(key, VECTORS.aad, "登录页重构完成"))).toBe("malformed");
  });

  it("rejects short passphrases and malformed keys", async () => {
    await expect(keyFromPassphrase("short")).rejects.toThrow(/至少 12/);
    expect(parseKeyText("obk1_short")).toBeNull();
    expect(parseKeyText(VECTORS.key.slice(5))).toBeNull();
  });
});
