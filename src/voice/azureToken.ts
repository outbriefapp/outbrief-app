import { responseSnippet, VoiceHttpError } from "./errors.ts";

/**
 * Free Azure Speech JWT ("path B"): sign a request as the Microsoft Translator Android app,
 * exchange it at the translator endpoint for `{ r: region, t: jwt }`, then call the regular
 * `{region}.tts|stt.speech.microsoft.com` REST endpoints with that JWT.
 */
const ENDPOINT_URL = "https://dev.microsofttranslator.com/apps/endpoint?api-version=1.0";
const SIGNATURE_APP_ID = "MSTranslatorAndroidApp";
const SIGNATURE_SECRET_BASE64 =
  "oik6PdDdMnOXemTbwvMn9de/h9lFnfBaCWbGMMZqqoSaQaqUOqjVGm5NqsmjcBI1x+sS9ugjB55HEJWRiFXYFw==";
/** Only consulted when a clock-skew rejection carries no readable `Date` header (CORS hides it). */
const SERVER_TIME_URL = "https://yd.transduck.com/api/servertime";
const REFRESH_BEFORE_EXPIRY_MS = 3 * 60 * 1000;

/** Region + JWT returned by the translator endpoint. */
export interface AzureEndpoint {
  region: string;
  token: string;
}

let signingKey: Promise<CryptoKey> | undefined;

/** `AppId::base64(HMAC-SHA256(secret, lower(AppId + urlencode(url sans scheme) + date + uuid)))::date::uuid` */
async function signEndpointRequest(now: Date, traceId: string): Promise<string> {
  signingKey ??= crypto.subtle.importKey(
    "raw",
    Uint8Array.from(atob(SIGNATURE_SECRET_BASE64), (c) => c.charCodeAt(0)),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  // e.g. "fri, 25 sep 2026 06:22:53 GMT" — lower-case except the zone, exactly as the app sends it.
  const date = `${now.toUTCString().replace("GMT", "").trim().toLowerCase()} GMT`;
  const url = encodeURIComponent(ENDPOINT_URL.split("://")[1] ?? "");
  const payload = `${SIGNATURE_APP_ID}${url}${date}${traceId}`.toLowerCase();
  const mac = await crypto.subtle.sign("HMAC", await signingKey, new TextEncoder().encode(payload));
  const macBase64 = btoa(String.fromCharCode(...new Uint8Array(mac)));
  return `${SIGNATURE_APP_ID}::${macBase64}::${date}::${traceId}`;
}

/** Milliseconds-since-epoch `exp` claim of a JWT. */
function jwtExpiryMs(token: string): number {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Azure endpoint token is not a JWT");
  const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
  const { exp } = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as {
    exp?: unknown;
  };
  if (typeof exp !== "number" || !Number.isFinite(exp)) throw new Error("JWT has no exp claim");
  return exp * 1000;
}

async function postEndpoint(now: Date): Promise<Response> {
  const traceId = crypto.randomUUID().replace(/-/g, "");
  return fetch(ENDPOINT_URL, {
    method: "POST",
    headers: {
      "Accept-Language": "zh-Hans",
      "X-ClientVersion": "4.0.530a 5fe1dc6c",
      "X-UserId": "0f04d16a175c411e",
      "X-HomeGeographicRegion": "zh-Hans-CN",
      "X-ClientTraceId": traceId,
      "X-MT-Signature": await signEndpointRequest(now, traceId),
      "Content-Type": "application/json; charset=utf-8",
    },
    body: "",
    // A WebView Referer makes the endpoint reject the signature with 401001.
    referrerPolicy: "no-referrer",
  });
}

/** 401001 / 401004 mean the signature date is outside the endpoint's accepted window. */
function isClockSkew(status: number, body: string): boolean {
  if (status !== 401) return false;
  try {
    const code = String((JSON.parse(body) as { error?: { code?: unknown } }).error?.code);
    return code === "401001" || code === "401004";
  } catch {
    return false;
  }
}

async function fetchServerTimeMs(failed: Response): Promise<number> {
  const header = Date.parse(failed.headers.get("date") ?? "");
  if (Number.isFinite(header)) return header;
  const resp = await fetch(SERVER_TIME_URL, { headers: { Accept: "application/json" } });
  if (!resp.ok) throw new VoiceHttpError(`server time HTTP ${resp.status}`, resp.status);
  const { epochMillis } = (await resp.json()) as { epochMillis?: unknown };
  if (typeof epochMillis !== "number") throw new Error("server time payload has no epochMillis");
  return epochMillis;
}

/**
 * Caches the Azure endpoint JWT, refreshing it 3 minutes before `exp`. Concurrent callers share one
 * in-flight fetch. Remembers the clock offset learned from a skew rejection for later refreshes.
 */
export class AzureTokenProvider {
  #lease: { endpoint: AzureEndpoint; expiresAt: number } | undefined;
  #pending: Promise<AzureEndpoint> | undefined;
  #clockOffsetMs = 0;

  /** Current endpoint, fetching a fresh one when missing or near expiry. */
  get(): Promise<AzureEndpoint> {
    if (this.#lease && Date.now() < this.#lease.expiresAt - REFRESH_BEFORE_EXPIRY_MS) {
      return Promise.resolve(this.#lease.endpoint);
    }
    this.#pending ??= this.#fetch().finally(() => {
      this.#pending = undefined;
    });
    return this.#pending;
  }

  /** Drops `rejected` (e.g. after a 401) unless it was already replaced by a newer token. */
  invalidate(rejected: AzureEndpoint): void {
    if (this.#lease?.endpoint === rejected) this.#lease = undefined;
  }

  async #fetch(): Promise<AzureEndpoint> {
    let resp = await postEndpoint(new Date(Date.now() + this.#clockOffsetMs));
    if (!resp.ok) {
      const body = await responseSnippet(resp);
      if (!isClockSkew(resp.status, body)) {
        throw new VoiceHttpError(`Azure endpoint HTTP ${resp.status}: ${body}`, resp.status);
      }
      const serverNow = await fetchServerTimeMs(resp);
      this.#clockOffsetMs = serverNow - Date.now();
      resp = await postEndpoint(new Date(serverNow));
      if (!resp.ok) {
        const retryBody = await responseSnippet(resp);
        throw new VoiceHttpError(`Azure endpoint HTTP ${resp.status}: ${retryBody}`, resp.status);
      }
    }
    const data = (await resp.json()) as { r?: unknown; t?: unknown };
    if (typeof data.r !== "string" || typeof data.t !== "string") {
      throw new VoiceHttpError("Azure endpoint payload has no r/t");
    }
    const endpoint = { region: data.r, token: data.t };
    this.#lease = { endpoint, expiresAt: jwtExpiryMs(endpoint.token) };
    return endpoint;
  }
}

/** Process-wide token shared by TTS and STT. */
export const azureTokens = new AzureTokenProvider();
