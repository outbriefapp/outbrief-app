import { t } from "./i18n/index.ts";
import type { AgentEvent, EventStatus } from "./protocol.ts";

const SOURCE_LABEL: Record<Exclude<AgentEvent["source"], "generic">, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
  "gemini-cli": "Gemini CLI",
  multica: "Multica Agent",
};

/** "待接听" / "已完成" / "已拒绝". */
export function statusLabel(status: EventStatus): string {
  return t().event.status[status];
}

/** Multica reports are from a named agent; other sources only know their CLI. */
export function callerName(e: AgentEvent): string {
  if (e.multica) return e.multica.agentName;
  return e.source === "generic" ? t().event.genericSource : SOURCE_LABEL[e.source];
}

/** The Multica project the call is about; null for local agents and issues in no project. */
export function projectName(e: AgentEvent): string | null {
  return e.multica?.projectTitle ?? null;
}

export function callerSubtitle(e: AgentEvent): string {
  if (e.multica) return `${e.multica.issueIdentifier} ${e.multica.issueTitle}`;
  return e.title ?? e.cwd ?? t().event.taskReport;
}

/** "2026-09-29 14:05:33" in local time: when a call arrived, down to the second (YOUT-212). */
export function formatDateTime(iso: string): string {
  const at = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}:${pad(at.getSeconds())}`;
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
