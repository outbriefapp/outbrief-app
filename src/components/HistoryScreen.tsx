import { Phone } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { type CallRecord, listCallRecords, updateCallRecord } from "../call/records.ts";
import { DECISIONS_MAX, TRANSCRIPT_MAX } from "../call/session.ts";
import type { CallContext } from "../call/useCall.ts";
import {
  ALL_PROJECTS,
  byProject,
  type CallProject,
  callsIn,
  issueRefs,
  priorityLabel,
  projectTabs,
  sortCalls,
  withIssue,
} from "../callList.ts";
import { type DaemonLink, fetchMulticaIssues } from "../daemonLink.ts";
import { applyUpdate } from "../e2e/events.ts";
import { callerName, callerSubtitle, formatDateTime, projectName, statusLabel } from "../format.ts";
import { useT } from "../i18n/index.ts";
import { multicaErrorText } from "../multicaSettings.ts";
import type { AgentEvent } from "../protocol.ts";
import { ActiveCall } from "./ActiveCall.tsx";
import { BackButton } from "./BackButton.tsx";
import { ChatLog } from "./ChatLog.tsx";
import { ProjectTabs } from "./ProjectTabs.tsx";
import { ReplyPanel } from "./ReplyPanel.tsx";

/**
 * The calls screen: missed calls (reports not answered yet, e.g. overnight in a quiet mode) on top,
 * answered straight from the list in any order, or all acknowledged at once (全部知悉: the user knows
 * about them and will not answer, YOUT-212); below them the finished calls saved on this device.
 * Every call shows when it arrived, down to the second.
 * One tab per project plus 全部, which groups both lists by project; each list puts the most urgent
 * issue first, then the most recently updated (YOUT-210). Multica issues of past calls are refreshed
 * from Multica through the local daemon (it holds the token) when the screen opens, and saved back.
 * The server keeps no history. `ctx` is null while the server connection is not set: calls can be
 * read but not refreshed, replayed or replied to.
 */
export function HistoryScreen(props: {
  ctx: CallContext | null;
  /** The daemon that looks up the Multica issues of past calls; null when there is none. */
  daemon: DaemonLink | null;
  /** Reports not answered yet, in ringing order. */
  missed: AgentEvent[];
  /** Ids of missed calls whose speech is ready: only those can be answered. */
  ready: ReadonlySet<string>;
  onAnswer: (eventId: string) => void;
  /** Saves the missed calls `eventIds` as acknowledged before returning. */
  onAcknowledge: (eventIds: string[]) => void;
  onBack: () => void;
}) {
  const msg = useT();
  const [records, setRecords] = useState(listCallRecords);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState(ALL_PROJECTS);
  const [refresh, setRefresh] = useState<{ error: string | null } | null>(null);
  const { daemon } = props;

  useEffect(() => {
    const refs = issueRefs(listCallRecords());
    if (!daemon || !refs.length) return;
    const ctrl = new AbortController();
    setRefresh(null);
    fetchMulticaIssues(daemon, refs, ctrl.signal).then(
      (issues) => {
        for (const { eventId } of listCallRecords()) {
          try {
            updateCallRecord(eventId, (r) => ({ ...r, event: withIssue(r.event, issues) }));
          } catch (err) {
            console.warn("[outbrief] update history", err);
          }
        }
        setRecords(listCallRecords());
        setRefresh({ error: null });
      },
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        console.warn("[outbrief] refresh issues", err);
        setRefresh({ error: multicaErrorText(err) });
      },
    );
    return () => ctrl.abort();
  }, [daemon]);

  const { missed } = props;
  const past = useMemo(() => sortCalls(records).map((r) => r.event), [records]);
  const tabs = useMemo(
    () => [
      { key: ALL_PROJECTS, label: msg.history.all, missed: missed.length, past: past.length },
      ...projectTabs(missed, past),
    ],
    [missed, past, msg],
  );
  // A tab whose last call is gone falls back to 全部.
  const current = tabs.some((t) => t.key === tab) ? tab : ALL_PROJECTS;
  const same = (e: AgentEvent) => e;
  const shownMissed = callsIn(missed, current, same);
  const shownPast = callsIn(past, current, same);
  const open = records.find((r) => r.eventId === selected);

  if (open) {
    return (
      <HistoryDetail
        record={open}
        ctx={props.ctx}
        onBack={() => {
          setRecords(listCallRecords());
          setSelected(null);
        }}
      />
    );
  }

  /** 全部 groups a list by project under a heading each; a project's tab needs no heading. */
  const grouped = (events: AgentEvent[], row: (e: AgentEvent) => ReactNode) =>
    current === ALL_PROJECTS ? (
      byProject(events, same).map(({ project, items }) => (
        <ProjectGroup key={project.key} project={project} count={items.length}>
          {items.map(row)}
        </ProjectGroup>
      ))
    ) : (
      <ul className="history-list">{events.map(row)}</ul>
    );

  const missedRow = (e: AgentEvent) => {
    const ready = props.ready.has(e.id);
    return (
      <li key={e.id}>
        <button
          type="button"
          className="history-row missed-row"
          disabled={!ready}
          onClick={() => props.onAnswer(e.id)}
        >
          <CallSummary event={e} />
          <div className="row-bottom">
            <span className="headline">
              {ready
                ? (e.brief?.brief?.verdict.headline ?? msg.history.noBrief)
                : msg.history.preparingVoice}
            </span>
            {ready && (
              <span className="answer-chip">
                <Phone size={14} aria-hidden />
                {msg.history.answer}
              </span>
            )}
          </div>
        </button>
      </li>
    );
  };

  const pastRow = (e: AgentEvent) => (
    <li key={e.id}>
      <button type="button" className="history-row" onClick={() => setSelected(e.id)}>
        <CallSummary event={e} />
        <div className="row-bottom">
          <span className={`status-tag ${e.status}`}>{statusLabel(e.status)}</span>
          <span className="headline">
            {e.brief?.brief?.verdict.headline ?? msg.history.noBrief}
          </span>
        </div>
      </button>
    </li>
  );

  return (
    <main className="screen history">
      <header className="idle-header">
        <BackButton onClick={props.onBack} />
        <span className="brand">{msg.history.title}</span>
        <span className="header-spacer" />
      </header>
      {(missed.length > 0 || records.length > 0) && (
        <ProjectTabs tabs={tabs} current={current} onSelect={setTab} />
      )}
      {refresh?.error && <p className="warn center">{msg.history.refreshFailed(refresh.error)}</p>}
      {shownMissed.length > 0 && (
        <section className="calls-section missed">
          <h2>
            {msg.history.missed}
            <span className="count missed">{shownMissed.length}</span>
            <button
              type="button"
              className="link acknowledge-all"
              title={msg.history.acknowledgeHint}
              onClick={() => {
                props.onAcknowledge(shownMissed.map((e) => e.id));
                setRecords(listCallRecords());
              }}
            >
              {msg.history.acknowledgeAll}
            </button>
          </h2>
          {grouped(shownMissed, missedRow)}
        </section>
      )}
      {shownPast.length > 0 && (
        <section className="calls-section">
          {shownMissed.length > 0 && <h2>{msg.history.past}</h2>}
          {grouped(shownPast, pastRow)}
        </section>
      )}
      {!records.length && !missed.length && <p className="muted center">{msg.history.empty}</p>}
      <p className="muted center">{msg.history.footnote}</p>
    </main>
  );
}

function ProjectGroup(props: { project: CallProject; count: number; children: ReactNode }) {
  return (
    <div className="project-group">
      <h3>
        {props.project.label}
        <span className="count">{props.count}</span>
      </h3>
      <ul className="history-list">{props.children}</ul>
    </div>
  );
}

/** Priority, agent and when the call arrived; then the issue (or the local task). */
function CallSummary(props: { event: AgentEvent }) {
  const msg = useT();
  const e = props.event;
  const priority = e.multica?.issuePriority;
  const priorityText = priority && priorityLabel(priority);
  return (
    <>
      <div className="row-top">
        <span className="row-caller">
          {priorityText && <span className={`priority-tag ${priority}`}>{priorityText}</span>}
          <strong>{callerName(e)}</strong>
        </span>
        <span
          className="muted call-time"
          title={
            e.multica?.issueUpdatedAt
              ? msg.history.issueUpdatedAt(formatDateTime(e.multica.issueUpdatedAt))
              : msg.history.receivedAt
          }
        >
          {formatDateTime(e.receivedAt)}
        </span>
      </div>
      <div className="row-title">{callerSubtitle(e)}</div>
    </>
  );
}

/** One past call: re-listen without reporting anything, or send a reply. */
function HistoryDetail(props: { record: CallRecord; ctx: CallContext | null; onBack: () => void }) {
  const msg = useT();
  const { ctx } = props;
  const [record, setRecord] = useState(props.record);
  const [replaying, setReplaying] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const { event } = record;

  if (replaying && ctx) {
    return (
      <ActiveCall
        event={event}
        ctx={ctx}
        waitingCount={0}
        onExit={() => setReplaying(false)}
        onComplete={() => setReplaying(false)}
      />
    );
  }

  const replied = record.reply !== null || !!event.delivery || !!event.multica?.reply;
  const headline = event.brief?.brief?.verdict.headline;
  return (
    <main className="screen history-detail">
      <header className="idle-header">
        <BackButton onClick={props.onBack} />
        <span className={`status-tag ${event.status}`}>{statusLabel(event.status)}</span>
      </header>
      <section className="history-meta">
        {projectName(event) && <p className="project-name">{projectName(event)}</p>}
        <h1>{callerName(event)}</h1>
        {event.title && <p className="row-title">{event.title}</p>}
        {event.cwd && <p className="muted mono">{event.cwd}</p>}
        <p className="muted">
          {msg.history.receivedAt} {formatDateTime(event.receivedAt)}
        </p>
        {headline && <p className="verdict">{headline}</p>}
      </section>
      <div className="row-actions">
        <button
          type="button"
          className="pill primary"
          disabled={!ctx}
          onClick={() => setReplaying(true)}
        >
          {msg.call.replay}
        </button>
      </div>
      {record.transcript.length > 0 && (
        <details className="history-transcript">
          <summary>{msg.history.transcript(record.transcript.length)}</summary>
          <ChatLog turns={record.transcript} />
        </details>
      )}
      {record.reply && <p className="muted center">{msg.history.sentReply(record.reply)}</p>}
      {ctx && !skipped && (event.delivery || !replied) ? (
        <ReplyPanel
          server={ctx.server}
          e2eKey={ctx.e2eKey}
          event={event}
          transcript={record.transcript.slice(-TRANSCRIPT_MAX)}
          decisions={record.decisions.slice(-DECISIONS_MAX)}
          onSent={(updated, content) => {
            const change = (r: CallRecord): CallRecord => ({
              ...r,
              event: applyUpdate(r.event, updated),
              reply: content,
            });
            setRecord(change);
            try {
              updateCallRecord(record.eventId, change);
            } catch (err) {
              console.warn("[outbrief] update history", err);
            }
          }}
          onSkip={() => setSkipped(true)}
        />
      ) : replied || skipped ? (
        <p className="muted center">{replied ? msg.history.replied : msg.history.skipped}</p>
      ) : (
        <p className="muted center">{msg.history.needsServer}</p>
      )}
    </main>
  );
}
