import { t } from "../i18n/index.ts";
/**
 * End-to-end encryption with the user's outbrief-daemon (outbrief-server ADR 0007), in WebCrypto.
 * Same format as outbrief-daemon `src/e2e/crypto.ts`; both test suites check the same vectors.
 *
 * - Key: 32 bytes, written `obk1_<base64url>`; or PBKDF2-HMAC-SHA256(passphrase, `KDF_SALT`,
 *   `KDF_ITERATIONS`).
 * - Sealed text: `ob1.<keyId>.<iv>.<ciphertext>`: AES-256-GCM, fresh 12-byte IV, 16-byte tag
 *   appended, AAD naming what the text is. `keyId` = first 8 bytes of
 *   SHA-256("outbrief-key-id" ‖ key), hex.
 */

export const KEY_PREFIX = "obk1_";
const SEALED_PREFIX = "ob1";
const KDF_SALT = "outbrief-e2e-v1";
const KDF_ITERATIONS = 600_000;
export const MIN_PASSPHRASE_CHARS = 12;

export const REPORT_AAD = "outbrief:report:v1";
export function replyAad(eventId: string): string {
  return `outbrief:reply:v1:${eventId}`;
}
export function replyErrorAad(replyId: string): string {
  return `outbrief:reply-error:v1:${replyId}`;
}
/** A settings request relayed to a daemon through the server, and the daemon's answer. */
export function settingsAad(requestId: string): string {
  return `outbrief:settings:v1:${requestId}`;
}
export function settingsResultAad(requestId: string): string {
  return `outbrief:settings-result:v1:${requestId}`;
}

/** Sealed text could not be opened. `wrong_key`: sealed with another device's key. */
export class SealedOpenError extends Error {
  override name = "SealedOpenError";
  readonly reason: "wrong_key" | "malformed" | "tampered";

  constructor(reason: SealedOpenError["reason"], message: string) {
    super(message);
    this.reason = reason;
  }
}

/** A usable key: the raw bytes for export, the WebCrypto key, and its id. */
export interface E2eKey {
  raw: Uint8Array<ArrayBuffer>;
  id: string;
  crypto: CryptoKey;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const b64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Imports 32 raw bytes as an AES-GCM key. */
export async function importKey(raw: Uint8Array<ArrayBuffer>): Promise<E2eKey> {
  if (raw.length !== 32) throw new Error("end-to-end key must be 32 bytes");
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new Uint8Array([...encoder.encode("outbrief-key-id"), ...raw]),
  );
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
  return { raw, id: hex(new Uint8Array(digest).subarray(0, 8)), crypto: key };
}

/** Parses `obk1_…`; null when it is not a 32-byte key. */
export function parseKeyText(text: string): Uint8Array<ArrayBuffer> | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(KEY_PREFIX)) return null;
  const encoded = trimmed.slice(KEY_PREFIX.length);
  if (!/^[A-Za-z0-9_-]{43}$/.test(encoded)) return null;
  const raw = fromBase64Url(encoded);
  return raw.length === 32 ? raw : null;
}

/** A new random key (`obk1_…`), for an account whose first device is this app. */
export function randomKeyText(): string {
  return `${KEY_PREFIX}${toBase64Url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export function formatKey(key: E2eKey): string {
  return `${KEY_PREFIX}${toBase64Url(key.raw)}`;
}

/** The same passphrase gives the same key on every device. */
export async function keyFromPassphrase(passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const normalized = passphrase.normalize("NFC");
  if ([...normalized].length < MIN_PASSPHRASE_CHARS) {
    throw new Error(t().e2e.tooShort(MIN_PASSPHRASE_CHARS));
  }
  const base = await crypto.subtle.importKey("raw", encoder.encode(normalized), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: encoder.encode(KDF_SALT), iterations: KDF_ITERATIONS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

/** `iv` is a test seam; production always draws a fresh one. */
export async function sealText(
  key: E2eKey,
  aad: string,
  plaintext: string,
  iv: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(12)),
): Promise<string> {
  const body = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
    key.crypto,
    encoder.encode(plaintext),
  );
  return [SEALED_PREFIX, key.id, toBase64Url(iv), toBase64Url(new Uint8Array(body))].join(".");
}

/** The key id sealed text names, or null when it is not sealed text. */
export function sealedKeyId(sealed: string): string | null {
  const parts = sealed.split(".");
  return parts.length === 4 && parts[0] === SEALED_PREFIX && parts[1] ? parts[1] : null;
}

export async function openText(key: E2eKey, aad: string, sealed: string): Promise<string> {
  const parts = sealed.split(".");
  const [version, id, ivText, bodyText] = parts;
  if (parts.length !== 4 || version !== SEALED_PREFIX || !id || !ivText || !bodyText) {
    throw new SealedOpenError("malformed", t().e2e.notSealed);
  }
  if (id !== key.id) {
    // The key ids tell a different key from damaged data; they are not shown to the user.
    throw new SealedOpenError("wrong_key", t().e2e.wrongKey);
  }
  let iv: Uint8Array<ArrayBuffer>;
  let body: Uint8Array<ArrayBuffer>;
  try {
    iv = fromBase64Url(ivText);
    body = fromBase64Url(bodyText);
  } catch {
    throw new SealedOpenError("malformed", t().e2e.notSealed);
  }
  if (iv.length !== 12 || body.length < 16)
    throw new SealedOpenError("malformed", t().e2e.notSealed);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: encoder.encode(aad) },
      key.crypto,
      body,
    );
    return decoder.decode(plain);
  } catch {
    throw new SealedOpenError("tampered", t().e2e.tampered);
  }
}

export async function sealJson(key: E2eKey, aad: string, value: unknown): Promise<string> {
  return sealText(key, aad, JSON.stringify(value));
}

export async function openJson(key: E2eKey, aad: string, sealed: string): Promise<unknown> {
  const text = await openText(key, aad, sealed);
  try {
    return JSON.parse(text);
  } catch {
    throw new SealedOpenError("malformed", t().e2e.notJson);
  }
}
