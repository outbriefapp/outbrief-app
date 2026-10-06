/**
 * Server API types the client consumes, and what the app reads once it opened them.
 *
 * The canonical contract (zod schemas) lives in outbrief-server `src/protocol.ts`; this file mirrors
 * the shapes by hand so the client has no build-time dependency on the server repo. Change both
 * together. Reports, briefs and replies travel sealed (end-to-end encryption, `src/e2e/`): the
 * server relays `RelayedEvent`s; the app opens them into `AgentEvent`s.
 */

import type { SpeechLanguage } from "./voice/languages.ts";

/** Where a report came from; `multica` = a finished Multica task (ingested by the server). */
export type AgentSource = "claude-code" | "codex" | "gemini-cli" | "generic" | "multica";

/**
 * received -> waiting for the call; completed -> taken and hung up; dismissed -> declined;
 * acknowledged -> a missed call the user knows about and will not answer (全部知悉, YOUT-212).
 */
export type EventStatus = "received" | "completed" | "dismissed" | "acknowledged";

/** Final statuses a client may set after a call (`POST /v1/events/:id/status`). */
export type CallOutcome = Exclude<EventStatus, "received">;

// --- Brief ------------------------------------------------------------------------------------

export type FactImportance = "critical" | "normal";

export interface BriefFact {
  id: string;
  text: string;
  importance: FactImportance;
}

export interface BriefCard {
  title: string;
  bullets: string[];
}

/** One "page" of the call: a spoken paragraph plus its card. Played in array order. */
export interface BriefSegment {
  id: string;
  /** Conversational spoken text; split into sentences for TTS. */
  speech: string;
  card: BriefCard;
  coveredFactIds: string[];
}

export interface DecisionOption {
  id: string;
  label: string;
}

export interface BriefDecision {
  id: string;
  question: string;
  options: DecisionOption[];
  recommendedOptionId: string | null;
  reason: string | null;
}

export type VerdictStatus = "done" | "partial" | "blocked" | "failed";

export interface Brief {
  verdict: { status: VerdictStatus; headline: string };
  facts: BriefFact[];
  segments: BriefSegment[];
  decisions: BriefDecision[];
}

export type LlmChannel = "primary" | "fallback";

/** ready -> `brief` holds the refined brief; failed -> `brief` is null, show the raw report. */
export type BriefStatus = "ready" | "failed";

export interface BriefEnvelope {
  status: BriefStatus;
  brief: Brief | null;
  llmChannel: LlmChannel | null;
  /** Why generation failed; null when ready. */
  error?: string | null;
  generatedAt: string;
}

// --- Sealed payloads (never seen by the server) --------------------------------------------------

/** Where a `multica` report came from, and where its reply is posted. */
export interface MulticaOrigin {
  workspaceId: string;
  issueId: string;
  /** e.g. "YOUT-149". */
  issueIdentifier: string;
  issueTitle: string;
  /**
   * The issue's project (null: in no project) and its priority / last update when the task
   * finished; the calls screen refreshes them from Multica. Absent on reports from older daemons.
   */
  projectId?: string | null;
  projectTitle?: string | null;
  /** "urgent" | "high" | "medium" | "low" | "none". */
  issuePriority?: string;
  issueUpdatedAt?: string;
  agentId: string;
  agentName: string;
  /** Last comment the task posted: replying to it wakes that same agent. */
  reportCommentId: string;
}

/** Plaintext of `RelayedEvent.sealed`, sealed by the daemon. AAD: `REPORT_AAD`. */
export interface SealedReport {
  title?: string;
  content: string;
  cwd?: string;
  sessionId?: string;
  brief: BriefEnvelope;
  multica?: MulticaOrigin;
}

/** Plaintext of `SendReplyInput.sealed`, opened by the daemon. AAD: `replyAad(eventId)`. */
export interface SealedReply {
  content: string;
  sessionId: string | null;
  multica: Pick<MulticaOrigin, "workspaceId" | "issueId" | "reportCommentId"> | null;
}

// --- Events as the server relays them --------------------------------------------------------------

export interface RelayedEvent {
  id: string;
  /** Monotonic server sequence; clients resume streams with it. */
  seq: number;
  source: AgentSource;
  status: EventStatus;
  occurredAt: string;
  receivedAt: string;
  /** The `SealedReport`. Null once the call ended: the server erases it. */
  sealed: string | null;
  multica?: { taskId: string; reply: MulticaReply | null };
  machine?: MachineRef;
  delivery?: RelayedDelivery;
}

export interface RelayedDelivery {
  id: string;
  status: DeliveryStatus;
  /** Sealed by the daemon (`replyErrorAad(id)`), or plain when it holds no content. */
  error: string | null;
  createdAt: string;
  settledAt: string | null;
  expiresAt: string;
}

// --- Events as the app reads them (opened) -------------------------------------------------------

export interface AgentEvent {
  id: string;
  /** Monotonic server sequence; clients resume streams with it. */
  seq: number;
  source: AgentSource;
  sessionId?: string;
  cwd?: string;
  title?: string;
  content: string;
  status: EventStatus;
  occurredAt: string;
  receivedAt: string;
  brief: BriefEnvelope | null;
  /** Present exactly when `source` is "multica". */
  multica?: MulticaReport;
  /** Present when an outbrief-daemon relayed the report. */
  machine?: MachineRef;
  /** Present once a reply to a daemon-relayed event was queued. */
  delivery?: Delivery;
}

/** The user's reply, posted as a Multica comment under the agent's report. */
export interface MulticaReply {
  commentId: string;
  sentAt: string;
}

/** Where a `multica` event came from, and where its reply goes. */
export interface MulticaReport extends MulticaOrigin {
  taskId: string;
  /** Null until the user sends a reply from OutBrief. */
  reply: MulticaReply | null;
}

/** Machine whose outbrief-daemon relayed the report; replies are delivered there. */
export interface MachineRef {
  id: string;
  name: string;
  /** The daemon is connected to the server right now. */
  online: boolean;
}

/** queued -> waiting to reach the daemon; dispatched -> daemon is running it; delivered/failed -> settled. */
export type DeliveryStatus = "queued" | "dispatched" | "delivered" | "failed";

export interface Delivery {
  /** Reply id; each id executes exactly once. */
  id: string;
  /** The reply as sent from this device; empty when it was sent from another device. */
  content: string;
  status: DeliveryStatus;
  /** Opened failure reason. */
  error: string | null;
  createdAt: string;
  settledAt: string | null;
  expiresAt: string;
}

/** SSE event name used on `/v1/stream`; the SSE `id` field carries `AgentEvent.seq`. */
export const STREAM_EVENT_NAME = "agent-event";

/** SSE event name for delivery status changes; `data` is the whole updated `RelayedEvent`. */
export const DELIVERY_EVENT_NAME = "event-delivery";

/**
 * Briefs call the listener by this placeholder; the client replaces it with the user's 称呼
 * before showing or speaking the brief (mirrors the server's `ADDRESS_PLACEHOLDER`).
 */
export const ADDRESS_PLACEHOLDER = "{称呼}";

/** `POST /v1/events/:id/reply` → the updated `RelayedEvent`. `sealed` is a `SealedReply`. */
export interface SendReplyInput {
  sealed: string;
}

/** `GET /e2e/key` / `PUT /e2e/key` on the local outbrief-daemon only (never relayed). */
export interface DaemonE2eKey {
  /** `obk1_…`. */
  key: string;
  keyId: string;
  source: "random" | "passphrase";
  updatedAt: string;
}

/** `PUT /e2e/key`; 422 `passphrase_too_short` / `invalid_key`. */
export type SetE2eKeyInput = { passphrase: string } | { key: string } | { random: true };

// The brief LLM of an outbrief-daemon (local or relayed), set from 设置 → 大模型. Mirrors
// outbrief-daemon `src/llm/settings.ts`; the key is write-only, answers carry `keyHint`.

export interface DaemonLlmChannel {
  baseUrl: string;
  model: string;
  /** "sk-…abcd". */
  keyHint: string;
  structuredOutput: "json_schema" | "json_object";
}

/** `GET` / `PUT` / `DELETE /llm/settings`: the endpoint briefs are written with, null when none. */
export interface DaemonLlmSettings {
  channel: DaemonLlmChannel | null;
}

/** `PUT /llm/settings`; 422 `invalid_llm_settings` / `llm_key_required`. */
export interface SaveDaemonLlmInput {
  baseUrl: string;
  apiKey: string;
  model: string;
  structuredOutput: "json_schema" | "json_object";
}

/**
 * `GET` / `PUT /brief/language` of an outbrief-daemon: the language it writes briefs in.
 * `source` is "system" until the app sets one. Mirrors outbrief-daemon `src/brief/settings.ts`.
 */
export interface DaemonBriefLanguage {
  language: SpeechLanguage;
  source: "app" | "system";
}

// Multica settings are served by the outbrief-daemon (locally, or relayed sealed), not the server:
// the user's Multica token stays on their own machine. Mirrors outbrief-daemon `src/settingsApi.ts`.

/** `GET /multica/settings` status: whether this machine's Multica tasks ring right now. */
export interface MulticaStatus {
  /** A Multica token is saved on this machine. */
  configured: boolean;
  connected: boolean;
  /** What the user should fix; null when healthy. */
  error: string | null;
}

// The token is write-only: the daemon answers with `tokenHint` and never sends the token back.

/** `POST /multica/workspaces` → `MulticaWorkspacesResponse`; 422 `invalid_multica_token`. */
export interface MulticaWorkspacesInput {
  token: string;
}

export interface MulticaWorkspace {
  id: string;
  name: string;
}

export interface MulticaWorkspacesResponse {
  workspaces: MulticaWorkspace[];
}

/** `PUT /multica/settings`; 422 `invalid_multica_token` / `workspace_not_found`. */
export interface SaveMulticaSettingsInput {
  token: string;
  workspaceId: string;
}

export interface MulticaSettings {
  workspaceId: string;
  workspaceName: string;
  /** e.g. "mul_…9f3a". */
  tokenHint: string;
  updatedAt: string;
}

/** `POST /multica/issues` → `MulticaIssuesResponse`; 422 `multica_not_configured`. */
export interface MulticaIssuesInput {
  issues: { workspaceId: string; issueId: string }[];
}

/** An issue as it is now in Multica. */
export interface MulticaIssueView {
  workspaceId: string;
  issueId: string;
  issueIdentifier: string;
  issueTitle: string;
  projectId: string | null;
  projectTitle: string | null;
  issuePriority: string;
  issueUpdatedAt: string;
}

/** Issues deleted or out of reach are left out. */
export interface MulticaIssuesResponse {
  issues: MulticaIssueView[];
}

// --- 主动派单 (outbrief-daemon `src/multica/dispatch.ts`) ----------------------------------------

/** A Multica project to dispatch into. */
export interface DispatchProject {
  id: string;
  title: string;
}

/** A Multica agent to dispatch to. */
export interface DispatchAgent {
  id: string;
  name: string;
  description: string;
  /** The machine its runtime is on is online: Multica refuses to dispatch to it otherwise. */
  online: boolean;
}

/** `GET /multica/dispatch/options`. */
export interface DispatchOptions {
  projects: DispatchProject[];
  agents: DispatchAgent[];
}

/** `POST /multica/dispatches`. */
export interface DispatchInput {
  projectId: string;
  agentId: string;
  /** What the user said; may be empty when images are sent. */
  prompt: string;
  /** Screenshots / photos sent with it, uploaded first (YOUT-226). */
  attachments?: DispatchAttachment[];
}

/** `POST /multica/uploads`: one image of a dispatch, uploaded to Multica by the daemon. */
export interface DispatchImage {
  name: string;
  /** `image/png`, `image/jpeg`, … */
  type: string;
  /** Base64 of the file. */
  data: string;
}

/** An uploaded dispatch image; mirrors outbrief-daemon `DispatchAttachment`. */
export interface DispatchAttachment {
  id: string;
  filename: string;
  /** The permanent URL of the image, for the request's markdown. */
  markdownUrl: string;
}

/**
 * - `creating`: the agent is turning the request into an issue (Multica's smart create)
 * - `created`: the issue exists
 * - `failed`: the agent created no issue; `error` says why
 * - `cancelled`: stopped before the issue was created
 */
export type DispatchState = "creating" | "created" | "failed" | "cancelled";

export interface DispatchIssue {
  id: string;
  identifier: string;
  title: string;
  /** Multica's status key ("todo", "in_progress", "in_review", "done", …). */
  status: string;
  priority: string;
}

/** One request dispatched from the app, as the daemon that sent it keeps it. */
export interface Dispatch {
  /** The Multica quick-create task. */
  id: string;
  workspaceId: string;
  projectId: string;
  projectTitle: string;
  agentId: string;
  agentName: string;
  prompt: string;
  /** Images sent with it; absent on dispatches made before images. */
  images?: number;
  createdAt: string;
  state: DispatchState;
  issue: DispatchIssue | null;
  /** Why it failed: `no_issue_created` / `task_lost` / `task_failed`, or Multica's own text. */
  error: string | null;
}

/** `GET` / `PUT /multica/settings`; `DELETE` answers 204. `settings` is null until saved. */
export interface MulticaSettingsResponse {
  settings: MulticaSettings | null;
  status: MulticaStatus;
}

// --- Accounts and devices (outbrief-server ADR 0008) ---------------------------------------------
// No login: an account is an anonymous id and every device holds its own token. The first device
// creates the account; the others join it with a one-time 6-digit pairing code.

export type DeviceKind = "daemon" | "app";

/** `GET /v1/server`: who may create an account on this server. */
export type SignupMode = "open" | "claim" | "closed";

export interface Device {
  id: string;
  name: string;
  kind: DeviceKind;
  /** A daemon holds its WebSocket, or an app its event stream, right now. */
  online: boolean;
  createdAt: string;
  lastSeenAt: string | null;
  /** The device asking. */
  current: boolean;
}

/** `POST /v1/accounts`, `POST /v1/pairing/redeem`. */
export interface DeviceSession {
  accountId: string;
  device: Device;
  /** Bearer for `/v1/*`, returned only once. */
  token: string;
}

/** `POST /v1/pairing`. */
export interface PairingCode {
  code: string;
  expiresAt: string;
}

/** `GET /v1/pairing/:code`. */
export interface PairingCodeStatus extends PairingCode {
  usedAt: string | null;
  usedBy: { id: string; name: string; kind: DeviceKind } | null;
}

/** `POST /local/pairing` on the local daemon: this machine's account, key included. */
export interface LocalPairing extends PairingCode {
  serverUrl: string;
  key: string;
  link: string;
}
