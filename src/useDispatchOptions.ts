import { useEffect, useState } from "react";
import { type DaemonLink, fetchDispatchOptions } from "./daemonLink.ts";
import { connectionProblem } from "./dispatch.ts";
import type { DispatchOptions } from "./protocol.ts";

/** How often the options (and so whether the computer is online) are read again. */
const REFRESH_MS = 10_000;

/**
 * The projects and agents to dispatch to, read through the daemon every `REFRESH_MS` while the
 * page is open: `problem` says why they cannot be read now (the computer is offline, Multica is
 * not set up on it…) and clears by itself once they can. The last options read stay in place.
 */
export function useDispatchOptions(link: DaemonLink | null): {
  options: DispatchOptions | null;
  problem: string | null;
} {
  const [options, setOptions] = useState<DispatchOptions | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!link) return;
    const ctrl = new AbortController();
    const load = () =>
      fetchDispatchOptions(link, ctrl.signal).then(
        (value) => {
          if (ctrl.signal.aborted) return;
          setOptions(value);
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
  }, [link]);

  return { options, problem };
}
