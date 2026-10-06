import type { DaemonLink } from "./daemonLink.ts";
import { errorMessage } from "./format.ts";
import { t } from "./i18n/index.ts";
import type { Dispatch, DispatchAgent, DispatchOptions, DispatchProject } from "./protocol.ts";
import { ServerError } from "./serverClient.ts";

/** Where the project and agent of the last dispatch are kept on this device. */
const LAST_PICK_KEY = "outbrief.dispatch.last";

/** The project and agent picked for the last dispatch. */
export interface LastPick {
  projectId: string;
  agentId: string;
}

export function loadLastPick(): LastPick | null {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_PICK_KEY) ?? "null") as Partial<LastPick>;
    return typeof value?.projectId === "string" && typeof value.agentId === "string"
      ? { projectId: value.projectId, agentId: value.agentId }
      : null;
  } catch {
    return null;
  }
}

export function saveLastPick(pick: LastPick): void {
  localStorage.setItem(LAST_PICK_KEY, JSON.stringify(pick));
}

/**
 * What the page starts with: the last dispatch's project and agent while they still exist;
 * otherwise the first project and the first agent that can run now (else the first agent).
 */
export function initialPick(
  options: DispatchOptions,
  last: LastPick | null,
): { project: DispatchProject | null; agent: DispatchAgent | null } {
  const project =
    options.projects.find((p) => p.id === last?.projectId) ?? options.projects[0] ?? null;
  const agent =
    options.agents.find((a) => a.id === last?.agentId) ??
    options.agents.find((a) => a.online) ??
    options.agents[0] ??
    null;
  return { project, agent };
}

/**
 * Why the options could not be read, for the line above the send button: the computer is offline
 * (or its daemon is not running), Multica is not set up on it, or what went wrong.
 */
export function connectionProblem(err: unknown, link: DaemonLink): string {
  const msg = t().dispatch;
  if (err instanceof ServerError) {
    if (err.code === "multica_not_configured") return msg.multicaNotSet;
    if (err.code === "machine_offline") return msg.machineOffline(err.message);
    if (err.status === null && link.kind === "local") return msg.localOffline;
  }
  return errorMessage(err);
}

/** Why Multica refused a dispatch, in words. */
export function refusalMessage(err: unknown, agentName: string): string {
  if (err instanceof ServerError && err.code === "agent_unavailable") {
    return err.detail
      ? t().dispatch.agentRefused(agentName, err.detail)
      : t().dispatch.agentUnavailable(agentName);
  }
  return t().dispatch.refused(errorMessage(err));
}

/** Why a dispatch created no issue: a known code in words, or Multica's own text. */
export function failureMessage(error: string | null): string {
  const msg = t().dispatch;
  return (error && msg.error[error]) || error || msg.error.task_failed || "";
}

/** The tag of a dispatch: the issue's status once it exists, else how the creation went. */
export function dispatchTag(d: Dispatch): string {
  const msg = t().dispatch;
  if (d.state === "created" && d.issue) {
    return msg.issueStatus[d.issue.status] ?? d.issue.status;
  }
  return msg.state[d.state] ?? d.state;
}
