import { Bell, BellOff, BellRing, Check, ChevronDown } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import {
  type CallMode,
  describeMode,
  describeRingState,
  type RingSchedule,
  type Weekday,
} from "../callModes.ts";
import { useT } from "../i18n/index.ts";
import { useDismiss } from "../useDismiss.ts";

function ModeIcon(props: { rule: CallMode["rule"] | null }) {
  if (props.rule === "quiet") return <BellOff size={16} aria-hidden />;
  if (props.rule === "ringOnly") return <BellRing size={16} aria-hidden />;
  return <Bell size={16} aria-hidden />;
}

/**
 * Today's mode as a chip in the idle screen's header, like the Focus / 免打扰 switch of phone and chat
 * apps: a bell (crossed out while calls do not ring) and the mode's name. It opens a menu to pick
 * another mode set for today or 随时响铃, and says when ringing changes; 管理模式 opens 设置 → 模式
 * (YOUT-210).
 */
export function ModeMenu(props: {
  modes: CallMode[];
  /** Includes the mode deciding today; its `mode` null: 随时响铃 today. */
  schedule: RingSchedule;
  /** Uses `modeId` today (null: 随时响铃 today), switching off the mode it replaces. */
  onSwitchMode: (modeId: string | null) => void;
  onManageModes: () => void;
}) {
  const msg = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);

  const { schedule } = props;
  const { mode } = schedule;
  const now = new Date();
  const today = props.modes.filter((m) => m.days.includes(now.getDay() as Weekday));
  const pick = (modeId: string | null) => {
    setOpen(false);
    if (modeId !== (mode?.id ?? null)) props.onSwitchMode(modeId);
  };
  const choice = (key: string, rule: CallMode["rule"] | null, name: string, hint: string) => {
    const selected = key === (mode?.id ?? "");
    return (
      <button
        key={key}
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        className="mode-choice"
        onClick={() => pick(key || null)}
      >
        <ModeIcon rule={rule} />
        <span className="mode-choice-text">
          <span>{name}</span>
          <span className="mode-choice-hint">{hint}</span>
        </span>
        {selected && <Check size={16} className="mode-check" aria-hidden />}
      </button>
    );
  };

  return (
    <div ref={ref} className="mode-menu">
      <button
        type="button"
        className={schedule.allowed ? "mode-chip" : "mode-chip silent"}
        aria-haspopup="menu"
        aria-expanded={open}
        title={describeRingState(schedule, now)}
        onClick={() => setOpen((o) => !o)}
      >
        {schedule.allowed ? <Bell size={15} aria-hidden /> : <BellOff size={15} aria-hidden />}
        <span className="mode-chip-name">{mode?.name ?? msg.modes.anyTime}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      {open && (
        <div className="mode-popover" role="menu">
          <p className={schedule.allowed ? "mode-state" : "mode-state warn"}>
            {describeRingState(schedule, now)}
          </p>
          {choice("", null, msg.modes.anyTime, msg.modes.ringsAnyTime)}
          {today.map((m) => choice(m.id, m.rule, m.name, describeMode(m)))}
          <button
            type="button"
            role="menuitem"
            className="mode-manage"
            onClick={() => {
              setOpen(false);
              props.onManageModes();
            }}
          >
            {msg.idle.manageModes}
          </button>
        </div>
      )}
    </div>
  );
}
