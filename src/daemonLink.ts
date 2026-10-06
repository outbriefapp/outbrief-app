import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  type E2eKey,
  openJson,
  SealedOpenError,
  sealJson,
  settingsAad,
  settingsResultAad,
} from "./e2e/crypto.ts";
import { t } from "./i18n/index.ts";
import type {
  DaemonBriefLanguage,
  DaemonE2eKey,
  DaemonLlmSettings,
  Device,
  Dispatch,
  DispatchAttachment,
  DispatchImage,
  DispatchInput,
  DispatchOptions,
  LocalPairing,
  MulticaIssuesInput,
  MulticaIssueView,
  MulticaSettingsResponse,
  MulticaWorkspace,
  MulticaWorkspacesInput,
  SaveDaemonLlmInput,
  SaveMulticaSettingsInput,
  SetE2eKeyInput,
} from "./protocol.ts";
import { relaySettings, ServerError, type ServerSettings, send } from "./serverClient.ts";
import type { SpeechLanguage } from "./voice/languages.ts";

/** The local outbrief-daemon's settings API (its default port). */
export const DAEMON_URL = "http://127.0.0.1:8790";

/**
 * How this app reaches an outbrief-daemon's settings (Multica, brief LLM, brief language):
 *
 * - `local`: the daemon on this machine, at `DAEMON_URL`, with the key in `~/.outbrief/local-api.key`
 *   (only the desktop app can read it). The only way to its end-to-end key and pairing code.
 * - `relay`: a daemon of this account elsewhere (a phone has none of its own): the request is
 *   sealed with the end-to-end key and relayed by the server over the daemon's WebSocket.
 */
export type DaemonLink =
  | { kind: "local"; localKey: string }
  | { kind: "relay"; server: ServerSettings; machine: Pick<Device, "id" | "name">; key: E2eKey };

type Method = "GET" | "POST" | "PUT" | "DELETE";

/**
 * The local daemon's key, read by the desktop shell from `local-api.key`; null in a browser, on a
 * phone, or when no daemon was ever started on this machine.
 */
export async function readLocalDaemonKey(): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("read_daemon_local_key");
}

/**
 * One settings call; resolves with the JSON answer (undefined for a 204). Throws `ServerError`:
 * `status` null when the daemon cannot be reached (not running, or its machine is offline), else
 * the daemon's status and `error` code.
 */
export async function daemonCall<T>(
  link: DaemonLink,
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  if (link.kind === "local") {
    const resp = await send(DAEMON_URL, path, {
      method,
      body,
      headers: { Authorization: `Bearer ${link.localKey}`, "Content-Type": "application/json" },
      ...(signal ? { signal } : {}),
    });
    return (resp.status === 204 ? undefined : await resp.json()) as T;
  }
  const requestId = crypto.randomUUID();
  const sealed = await sealJson(link.key, settingsAad(requestId), { method, path, body });
  let answer: string;
  try {
    answer = await relaySettings(link.server, link.machine.id, requestId, sealed, signal);
  } catch (err) {
    if (err instanceof ServerError && (err.code === "machine_offline" || err.status === 504)) {
      throw new ServerError(t().daemon.offline(link.machine.name), null, {
        cause: err,
        code: "machine_offline",
      });
    }
    throw err;
  }
  let result: { status: number; body?: { error?: unknown; message?: unknown } };
  try {
    result = (await openJson(link.key, settingsResultAad(requestId), answer)) as typeof result;
  } catch (err) {
    if (err instanceof SealedOpenError) {
      throw new ServerError(t().daemon.keyMismatch(link.machine.name), 400, {
        cause: err,
        code: "undecryptable_request",
      });
    }
    throw err;
  }
  if (result.body?.error === "undecryptable_request") {
    throw new ServerError(t().daemon.keyMismatch(link.machine.name), 400, {
      code: "undecryptable_request",
    });
  }
  if (result.status >= 400) {
    const code = typeof result.body?.error === "string" ? result.body.error : null;
    const message = typeof result.body?.message === "string" ? result.body.message : "";
    throw new ServerError(t().server.failed(path, result.status, code ?? message), result.status, {
      code,
      detail: message || null,
    });
  }
  return result.body as T;
}

/** Where the daemon is, for messages: "本机" or the machine's name. */
export function daemonLabel(link: DaemonLink): string {
  return link.kind === "local" ? t().daemon.local : link.machine.name;
}

// --- The settings API (outbrief-daemon `src/settingsApi.ts`) -------------------------------------

/** This machine's end-to-end key; local only. */
export function fetchDaemonE2eKey(
  link: Extract<DaemonLink, { kind: "local" }>,
  signal?: AbortSignal,
): Promise<DaemonE2eKey> {
  return daemonCall(link, "GET", "/e2e/key", undefined, signal);
}

/** Replaces this machine's end-to-end key; local only. 422 `passphrase_too_short` / `invalid_key`. */
export function setDaemonE2eKey(
  link: Extract<DaemonLink, { kind: "local" }>,
  input: SetE2eKeyInput,
): Promise<DaemonE2eKey> {
  return daemonCall(link, "PUT", "/e2e/key", input);
}

/** A pairing code (and key) for this machine's account; local only. */
export function fetchLocalPairing(
  link: Extract<DaemonLink, { kind: "local" }>,
): Promise<LocalPairing> {
  return daemonCall(link, "POST", "/local/pairing");
}

/** Makes this endpoint the daemon's brief LLM; the next brief uses it. */
export function saveDaemonLlm(
  link: DaemonLink,
  input: SaveDaemonLlmInput,
): Promise<DaemonLlmSettings> {
  return daemonCall(link, "PUT", "/llm/settings", input);
}

/** Removes the daemon's brief LLM; briefs then fail and calls read the raw report. */
export function removeDaemonLlm(link: DaemonLink): Promise<DaemonLlmSettings> {
  return daemonCall(link, "DELETE", "/llm/settings");
}

/** Sets the language the daemon writes briefs in; the next brief uses it. */
export function setDaemonBriefLanguage(
  link: DaemonLink,
  language: SpeechLanguage,
  signal?: AbortSignal,
): Promise<DaemonBriefLanguage> {
  return daemonCall(link, "PUT", "/brief/language", { language }, signal);
}

/** The machine's Multica token (as a hint) and workspace, with the live connection state. */
export function fetchMulticaSettings(
  link: DaemonLink,
  signal?: AbortSignal,
): Promise<MulticaSettingsResponse> {
  return daemonCall(link, "GET", "/multica/settings", undefined, signal);
}

/** Workspaces a token can reach; 422 `invalid_multica_token` when Multica rejects it. */
export async function listMulticaWorkspaces(
  link: DaemonLink,
  token: string,
): Promise<MulticaWorkspace[]> {
  const body: MulticaWorkspacesInput = { token };
  return (
    await daemonCall<{ workspaces: MulticaWorkspace[] }>(link, "POST", "/multica/workspaces", body)
  ).workspaces;
}

/** The daemon checks the token with Multica, saves it on its machine, and listens with it. */
export function saveMulticaSettings(
  link: DaemonLink,
  input: SaveMulticaSettingsInput,
): Promise<MulticaSettingsResponse> {
  return daemonCall(link, "PUT", "/multica/settings", input);
}

export async function removeMulticaSettings(link: DaemonLink): Promise<void> {
  await daemonCall(link, "DELETE", "/multica/settings");
}

/** The daemon reads these issues from Multica as they are now (project, priority, last update). */
export async function fetchMulticaIssues(
  link: DaemonLink,
  issues: MulticaIssuesInput["issues"],
  signal?: AbortSignal,
): Promise<MulticaIssueView[]> {
  const body: MulticaIssuesInput = { issues };
  return (
    await daemonCall<{ issues: MulticaIssueView[] }>(link, "POST", "/multica/issues", body, signal)
  ).issues;
}

// --- 主动派单 (outbrief-daemon `src/multica/dispatch.ts`) ----------------------------------------

/** Projects and agents to dispatch to, with whether each agent's machine is online. */
export function fetchDispatchOptions(
  link: DaemonLink,
  signal?: AbortSignal,
): Promise<DispatchOptions> {
  return daemonCall(link, "GET", "/multica/dispatch/options", undefined, signal);
}

/**
 * Uploads one dispatch image to the machine's Multica workspace (up to Multica's 100 MB); the
 * dispatch then refers to it. 400 `invalid_dispatch` when it is not an image or is too big.
 */
export async function uploadDispatchImage(
  link: DaemonLink,
  image: DispatchImage,
): Promise<DispatchAttachment> {
  return (
    await daemonCall<{ attachment: DispatchAttachment }>(link, "POST", "/multica/uploads", image)
  ).attachment;
}

/**
 * The picked agent turns what the user said into an issue (Multica's smart create). 422
 * `agent_unavailable` (Multica's reason in `detail`) / `project_not_found` / `agent_not_found`.
 */
export async function createDispatch(link: DaemonLink, input: DispatchInput): Promise<Dispatch> {
  return (await daemonCall<{ dispatch: Dispatch }>(link, "POST", "/multica/dispatches", input))
    .dispatch;
}

/** What was dispatched from that machine, newest first, as it is now in Multica. */
export async function fetchDispatches(link: DaemonLink, signal?: AbortSignal): Promise<Dispatch[]> {
  return (
    await daemonCall<{ dispatches: Dispatch[] }>(
      link,
      "GET",
      "/multica/dispatches",
      undefined,
      signal,
    )
  ).dispatches;
}

/** One dispatch, as it is now. */
export async function lookupDispatch(
  link: DaemonLink,
  id: string,
  signal?: AbortSignal,
): Promise<Dispatch> {
  return (
    await daemonCall<{ dispatch: Dispatch }>(
      link,
      "POST",
      "/multica/dispatches/lookup",
      { id },
      signal,
    )
  ).dispatch;
}

/** Stops the agent before it creates the issue. */
export async function cancelDispatch(link: DaemonLink, id: string): Promise<Dispatch> {
  return (
    await daemonCall<{ dispatch: Dispatch }>(link, "POST", "/multica/dispatches/cancel", { id })
  ).dispatch;
}
