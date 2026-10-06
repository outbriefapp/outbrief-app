import type { CallRecord } from "./call/records.ts";
import { t } from "./i18n/index.ts";
import type { AgentEvent, MulticaIssueView } from "./protocol.ts";

/** Multica's priorities, most urgent first; anything else ranks with "none". */
const PRIORITY_ORDER = ["urgent", "high", "medium", "low", "none"];

/** "紧急" / "高" / "中" / "低"; null for "none" and anything unknown. */
export function priorityLabel(priority: string): string | null {
  return t().history.priority[priority] ?? null;
}

/** Tab key of the list that is not split by project. */
export const ALL_PROJECTS = "all";

/** Which project a call belongs to, for the tabs of the calls screen. */
export interface CallProject {
  key: string;
  label: string;
}

/**
 * The Multica project the call's issue is in; null for calls outside any project: local agent
 * reports and issues in no project. Folder names and "本机 Agent" are not projects, so they get no
 * tab (YOUT-212); calls from daemons that did not read projects yet have none until refreshed.
 */
export function callProject(e: AgentEvent): CallProject | null {
  const projectId = e.multica?.projectId;
  const projectTitle = e.multica?.projectTitle;
  return projectId && projectTitle ? { key: `multica:${projectId}`, label: projectTitle } : null;
}

/** Under 全部, calls outside any project come last, headed 其他. */
export const OTHER_CALLS = "other";

/** 0 = urgent … 4 = none; calls outside Multica have no priority. */
export function priorityRank(e: AgentEvent): number {
  const rank = PRIORITY_ORDER.indexOf(e.multica?.issuePriority ?? "none");
  return rank < 0 ? PRIORITY_ORDER.length - 1 : rank;
}

/** When the call's work last changed: the Multica issue's update, else when the call arrived. */
export function updatedAt(e: AgentEvent): string {
  return e.multica?.issueUpdatedAt ?? e.receivedAt;
}

/**
 * Most urgent issue first; the same priority, the most recently updated first. The order of the
 * calls screen, and the order waiting calls ring in; ties ring in arrival order.
 */
export function compareCalls(a: AgentEvent, b: AgentEvent): number {
  return (
    priorityRank(a) - priorityRank(b) ||
    updatedAt(b).localeCompare(updatedAt(a)) ||
    b.receivedAt.localeCompare(a.receivedAt) ||
    a.seq - b.seq
  );
}

export function sortCalls(records: CallRecord[]): CallRecord[] {
  return [...records].sort((a, b) => compareCalls(a.event, b.event));
}

/** A project's tab: how many missed calls and how many past calls it has. */
export interface ProjectTab extends CallProject {
  missed: number;
  past: number;
}

/**
 * One tab per project, in the order its first call appears: missed calls first, then past calls
 * (both sorted). Calls outside any project have no tab: they are only under 全部.
 */
export function projectTabs(missed: AgentEvent[], past: AgentEvent[]): ProjectTab[] {
  const tabs = new Map<string, ProjectTab>();
  const count = (e: AgentEvent, field: "missed" | "past") => {
    const project = callProject(e);
    if (!project) return;
    const tab = tabs.get(project.key) ?? { ...project, missed: 0, past: 0 };
    tab[field]++;
    tabs.set(project.key, tab);
  };
  for (const e of missed) count(e, "missed");
  for (const e of past) count(e, "past");
  return [...tabs.values()];
}

/** The calls shown under `tab` (`ALL_PROJECTS` or a project key), keeping their order. */
export function callsIn<T>(sorted: T[], tab: string, eventOf: (item: T) => AgentEvent): T[] {
  return tab === ALL_PROJECTS ? sorted : sorted.filter((i) => callProject(eventOf(i))?.key === tab);
}

/**
 * `sorted` split by project, a group per project in the order its first call appears; calls outside
 * any project last, in one group headed 其他.
 */
export function byProject<T>(
  sorted: T[],
  eventOf: (item: T) => AgentEvent,
): { project: CallProject; items: T[] }[] {
  const groups = new Map<string, { project: CallProject; items: T[] }>();
  const other = { project: { key: OTHER_CALLS, label: t().history.otherCalls }, items: [] as T[] };
  for (const item of sorted) {
    const project = callProject(eventOf(item));
    if (!project) {
      other.items.push(item);
      continue;
    }
    const group = groups.get(project.key);
    if (group) group.items.push(item);
    else groups.set(project.key, { project, items: [item] });
  }
  return other.items.length ? [...groups.values(), other] : [...groups.values()];
}

/** Workspace + issue of every Multica call, once each: what to refresh from Multica. */
export function issueRefs(records: CallRecord[]): { workspaceId: string; issueId: string }[] {
  const refs = new Map<string, { workspaceId: string; issueId: string }>();
  for (const { event } of records) {
    const m = event.multica;
    if (m)
      refs.set(`${m.workspaceId}/${m.issueId}`, { workspaceId: m.workspaceId, issueId: m.issueId });
  }
  return [...refs.values()];
}

/** `event` with its issue as Multica has it now; unchanged when `issues` does not include it. */
export function withIssue(event: AgentEvent, issues: MulticaIssueView[]): AgentEvent {
  const m = event.multica;
  const issue = m && issues.find((i) => i.workspaceId === m.workspaceId && i.issueId === m.issueId);
  if (!m || !issue) return event;
  return {
    ...event,
    multica: {
      ...m,
      issueIdentifier: issue.issueIdentifier,
      issueTitle: issue.issueTitle,
      projectId: issue.projectId,
      projectTitle: issue.projectTitle,
      issuePriority: issue.issuePriority,
      issueUpdatedAt: issue.issueUpdatedAt,
    },
  };
}
