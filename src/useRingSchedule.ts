import { useEffect, useState } from "react";
import { type CallMode, type RingSchedule, ringSchedule } from "./callModes.ts";

/**
 * Checks at most a minute apart (a sleeping laptop or a changed clock never leaves it stale for
 * long), and exactly when the schedule flips.
 */
const MAX_CHECK_MS = 60_000;

/** Whether calls may ring now with the modes that are on, updated as the week goes on. */
export function useRingSchedule(on: CallMode[]): RingSchedule {
  const [schedule, setSchedule] = useState(() => ringSchedule(on, new Date()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      const now = new Date();
      const next = ringSchedule(on, now);
      setSchedule((prev) =>
        prev.allowed === next.allowed &&
        prev.nextChange?.getTime() === next.nextChange?.getTime() &&
        prev.mode === next.mode
          ? prev
          : next,
      );
      const wait = next.nextChange ? next.nextChange.getTime() - now.getTime() : MAX_CHECK_MS;
      timer = setTimeout(update, Math.max(1_000, Math.min(MAX_CHECK_MS, wait)));
    };
    update();
    return () => clearTimeout(timer);
  }, [on]);
  return schedule;
}
