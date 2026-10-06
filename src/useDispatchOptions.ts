import { useEffect, useState } from "react";
import { type DaemonLink, fetchDispatchOptions, fetchMulticaSettings } from "./daemonLink.ts";
import { connectionProblem } from "./dispatch.ts";
import type { DispatchOptions, MulticaWorkspace } from "./protocol.ts";

/** How often the options (and so whether the computer is online) are read again. */
const REFRESH_MS = 10_000;

/**
 * The projects and agents to dispatch to in `workspaceId` (the daemon's first workspace when
 * absent), read through the daemon every `REFRESH_MS` while the page is open: `problem` says why they cannot be read now (the computer is offline, Multica is
 * not set up on it…) and clears by itself once they can. The last options read stay in place.
 */
export function useDispatchOptions(
  link: DaemonLink | null,
  workspaceId?: string,
): {
  options: DispatchOptions | null;
  problem: string | null;
} {
  // Tagged with their workspace, so another workspace's never show while this one's are read.
  const [read, setRead] = useState<{ workspaceId?: string; options: DispatchOptions } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    const ctrl = new AbortController();
    const load = () =>
      fetchDispatchOptions(link, workspaceId, ctrl.signal).then(
        (value) => {
          if (ctrl.signal.aborted) return;
          setRead({ workspaceId, options: value });
          setProblem(null);
        },
        (err: unknown) => {
          if (ctrl.signal.aborted) return;
          console.warn("[outbrief] dispatch options", err);
          setProblem(connectionProblem(err, link));
        },
      );
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [link, workspaceId]);

  return { options: read && read.workspaceId === workspaceId ? read.options : null, problem };
}

/**
 * The workspaces the daemon listens to, read once: empty until read, and from a daemon that
 * listens to one workspace only (it dispatches there by itself).
 */
export function useListenedWorkspaces(link: DaemonLink | null): MulticaWorkspace[] {
  const [workspaces, setWorkspaces] = useState<MulticaWorkspace[]>([]);
  useEffect(() => {
    setWorkspaces([]);
    if (!link) return;
    const ctrl = new AbortController();
    fetchMulticaSettings(link, ctrl.signal).then(
      (current) => !ctrl.signal.aborted && setWorkspaces(current.settings?.workspaces ?? []),
      // Without the list the page dispatches to the first workspace, like before.
      (err: unknown) => !ctrl.signal.aborted && console.warn("[outbrief] multica settings", err),
    );
    return () => ctrl.abort();
  }, [link]);
  return workspaces;
}
