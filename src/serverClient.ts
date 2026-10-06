import { t } from "./i18n/index.ts";
import {
  type CallOutcome,
  DELIVERY_EVENT_NAME,
  type Device,
  type DeviceKind,
  type DeviceSession,
  type PairingCode,
  type PairingCodeStatus,
  type RelayedEvent,
  type SendReplyInput,
  type SignupMode,
  STREAM_EVENT_NAME,
} from "./protocol.ts";
import { SseParser } from "./sse.ts";

/** Where the relay server is and this device's token there. There is no login. */
export interface ServerSettings {
  serverUrl: string;
  /** This device's own token (outbrief-server ADR 0008). */
  token: string;
}

/** What a new device says about itself. */
export interface NewDevice {
  name: string;
  kind: DeviceKind;
}

const JSON_HEADERS: HeadersInit = { "Content-Type": "application/json" };

/** `unauthorized`: the server rejected this device's token (it was removed); the stream stops. */
export type ConnectionStatus = "connecting" | "online" | "offline" | "unauthorized";

const MAX_BACKOFF_MS = 30_000;

function authHeaders(s: ServerSettings): HeadersInit {
  return { Authorization: `Bearer ${s.token}`, "Content-Type": "application/json" };
}

/**
 * A server request failed: `status` is the HTTP status, or null when the connection broke.
 */
export class ServerError extends Error {
  override name = "ServerError";
  readonly status: number | null;
  /** The body's `error` code (e.g. "invalid_multica_token"); null when there was none. */
  readonly code: string | null;
  /** The body's `message` (e.g. Multica's reason for refusing a dispatch); null when there was none. */
  readonly detail: string | null;

  constructor(
    message: string,
    status: number | null,
    options?: ErrorOptions & { code?: string | null; detail?: string | null },
  ) {
    super(message, options);
    this.status = status;
    this.code = options?.code ?? null;
    this.detail = options?.detail ?? null;
  }
}

/** Sends a request; throws `ServerError` on network failure or a non-2xx status. */
export async function send(
  serverUrl: string,
  path: string,
  init: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
    headers: HeadersInit;
  },
): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(new URL(path, serverUrl), {
      method: init.method ?? "GET",
      headers: init.headers,
      body: init.body === undefined ? null : JSON.stringify(init.body),
      signal: init.signal ?? null,
    });
  } catch (err) {
    if (init.signal?.aborted) throw err;
    throw new ServerError(t().server.unreachable(String(err)), null, { cause: err });
  }
  if (resp.ok) return resp;
  // Error bodies are `{ error, message? }` JSON; fall back to the status line for anything else.
  const body = (await resp.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;
  const code = typeof body?.error === "string" ? body.error : null;
  const message = typeof body?.message === "string" && body.message ? body.message : null;
  const detail = code ? `${code}${message ? `（${message}）` : ""}` : null;
  throw new ServerError(t().server.failed(path, resp.status, detail ?? ""), resp.status, {
    code,
    detail: message,
  });
}

/** Sends an authorized request; throws `ServerError` on network failure or a non-2xx status. */
function request(
  s: ServerSettings,
  path: string,
  init: { method?: "GET" | "POST" | "PUT" | "DELETE"; body?: unknown; signal?: AbortSignal } = {},
): Promise<Response> {
  return send(s.serverUrl, path, { ...init, headers: authHeaders(s) });
}

export async function reportOutcome(
  s: ServerSettings,
  eventId: string,
  status: CallOutcome,
): Promise<void> {
  await request(s, `/v1/events/${encodeURIComponent(eventId)}/status`, {
    method: "POST",
    body: { status },
  });
}

/**
 * Queues the sealed reply for the daemon that reported the call (it posts it to Multica or resumes
 * the agent session); resolves with the updated event.
 */
export async function sendReply(
  s: ServerSettings,
  eventId: string,
  sealed: string,
): Promise<RelayedEvent> {
  const body: SendReplyInput = { sealed };
  const resp = await request(s, `/v1/events/${encodeURIComponent(eventId)}/reply`, {
    method: "POST",
    body,
  });
  return (await resp.json()) as RelayedEvent;
}

// --- Accounts and devices (outbrief-server ADR 0008) --------------------------------------------

/** Who may create an account on the server at `serverUrl`. */
export async function fetchSignupMode(serverUrl: string): Promise<SignupMode> {
  const resp = await send(serverUrl, "/v1/server", { headers: JSON_HEADERS });
  return ((await resp.json()) as { signup: SignupMode }).signup;
}

/** Creates an anonymous account with this device as its first; 403 `signup_closed` / `invalid_claim_code`. */
export async function createAccount(
  serverUrl: string,
  device: NewDevice,
  claimCode?: string,
): Promise<DeviceSession> {
  const resp = await send(serverUrl, "/v1/accounts", {
    method: "POST",
    body: { device, ...(claimCode ? { claimCode } : {}) },
    headers: JSON_HEADERS,
  });
  return (await resp.json()) as DeviceSession;
}

/** Joins the account of a pairing code; 404 `invalid_pairing_code`, 429 `rate_limited`. */
export async function redeemPairingCode(
  serverUrl: string,
  code: string,
  device: NewDevice,
): Promise<DeviceSession> {
  const resp = await send(serverUrl, "/v1/pairing/redeem", {
    method: "POST",
    body: { code, device },
    headers: JSON_HEADERS,
  });
  return (await resp.json()) as DeviceSession;
}

/** The devices of this account, oldest first. */
export async function listDevices(s: ServerSettings, signal?: AbortSignal): Promise<Device[]> {
  const resp = await request(s, "/v1/devices", signal ? { signal } : {});
  return ((await resp.json()) as { devices: Device[] }).devices;
}

/** Removes a device of this account; its token stops working at once. */
export async function removeDevice(s: ServerSettings, deviceId: string): Promise<void> {
  await request(s, `/v1/devices/${encodeURIComponent(deviceId)}`, { method: "DELETE" });
}

/** A one-time code (10 minutes) another device joins this account with. */
export async function createPairingCode(s: ServerSettings): Promise<PairingCode> {
  const resp = await request(s, "/v1/pairing", { method: "POST" });
  return (await resp.json()) as PairingCode;
}

export async function fetchPairingStatus(
  s: ServerSettings,
  code: string,
  signal?: AbortSignal,
): Promise<PairingCodeStatus> {
  const resp = await request(
    s,
    `/v1/pairing/${encodeURIComponent(code)}`,
    signal ? { signal } : {},
  );
  return (await resp.json()) as PairingCodeStatus;
}

/**
 * Hands a sealed settings request to one of this account's daemons through the server and
 * resolves with its sealed answer (see `daemonLink.ts`).
 */
export async function relaySettings(
  s: ServerSettings,
  machineId: string,
  requestId: string,
  sealed: string,
  signal?: AbortSignal,
): Promise<string> {
  const resp = await request(s, `/v1/devices/${encodeURIComponent(machineId)}/settings`, {
    method: "POST",
    body: { requestId, sealed },
    ...(signal ? { signal } : {}),
  });
  return ((await resp.json()) as { sealed: string }).sealed;
}

/**
 * Keeps an SSE connection to `/v1/stream` open until `signal` aborts, reconnecting with exponential
 * backoff and resuming from the last seen sequence so nothing pending is missed.
 */
export async function followEventStream(
  s: ServerSettings,
  handlers: {
    onEvent: (e: RelayedEvent) => void;
    onStatus: (s: ConnectionStatus) => void;
    onEventUpdated?: (e: RelayedEvent) => void;
  },
  signal: AbortSignal,
): Promise<void> {
  let lastSeq = 0;
  let backoff = 1_000;
  while (!signal.aborted) {
    handlers.onStatus("connecting");
    try {
      const resp = await fetch(new URL("/v1/stream", s.serverUrl), {
        headers: {
          ...authHeaders(s),
          Accept: "text/event-stream",
          "Last-Event-ID": String(lastSeq),
        },
        signal,
      });
      if (resp.status === 401) {
        await resp.body?.cancel();
        handlers.onStatus("unauthorized");
        return;
      }
      if (!resp.ok || !resp.body) throw new Error(`stream HTTP ${resp.status}`);
      handlers.onStatus("online");
      backoff = 1_000;
      const parser = new SseParser();
      const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        for (const frame of parser.push(value)) {
          if (frame.event === DELIVERY_EVENT_NAME) {
            handlers.onEventUpdated?.(JSON.parse(frame.data) as RelayedEvent);
            continue;
          }
          if (frame.event !== STREAM_EVENT_NAME) continue;
          const event = JSON.parse(frame.data) as RelayedEvent;
          lastSeq = Math.max(lastSeq, event.seq);
          handlers.onEvent(event);
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      console.warn("[outbrief] stream error", err);
    }
    handlers.onStatus("offline");
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}
