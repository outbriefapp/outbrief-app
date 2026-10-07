import { type FormEvent, useMemo, useState } from "react";
import Picker from "react-mobile-picker";
import {
  type CallMode,
  clashes,
  dayChar,
  dayName,
  describeDays,
  describeRanges,
  describeRingState,
  MODE_NAME_MAX,
  modeProblem,
  switchOn,
  type TimeRange,
  WEEK,
  type Weekday,
} from "../callModes.ts";
import { t, useT } from "../i18n/index.ts";
import { type AppSettings, activeModes } from "../settings.ts";
import { useRingSchedule } from "../useRingSchedule.ts";
import { BackButton } from "./BackButton.tsx";
import type { SettingsPatch } from "./SettingsForm.tsx";

const RULES: CallMode["rule"][] = ["ringOnly", "quiet"];

const NEW_RANGE: TimeRange = { start: "09:00", end: "18:00" };

function newMode(): CallMode {
  return {
    id: crypto.randomUUID(),
    name: "",
    rule: "ringOnly",
    ranges: [NEW_RANGE],
    days: [...WEEK],
  };
}

/** "已关闭「工作」：和「周末」都用在周六". */
function clashNotice(off: CallMode[], mode: CallMode): string | null {
  if (off.length === 0) return null;
  const days = WEEK.filter((d) => mode.days.includes(d) && off.some((m) => m.days.includes(d)));
  return t().modes.clash(
    off.map((m) => m.name),
    mode.name,
    describeDays(days),
  );
}

/**
 * 设置 → 模式, laid out like an alarm clock: a list of modes, each with its time, its 重复 days and a
 * switch. Several modes may be on as long as no day of the week has two (switching one on turns off
 * the ones sharing a day with it); a day without one rings any time. Switches save at once; tapping
 * a mode opens its editor, which saves on 存储. The idle screen switches today's mode too.
 */
export function ModesPage(props: {
  settings: AppSettings;
  onSave: (patch: SettingsPatch) => void;
  onBack: () => void;
}) {
  const msg = useT();
  const { modes, activeModeIds } = props.settings;
  const [editing, setEditing] = useState<{ mode: CallMode; isNew: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const schedule = useRingSchedule(useMemo(() => activeModes(props.settings), [props.settings]));
  const today = schedule.mode;

  const turnOn = (nextModes: CallMode[], mode: CallMode) => {
    setNotice(clashNotice(clashes(nextModes, activeModeIds, mode), mode));
    return switchOn(nextModes, activeModeIds, mode);
  };

  if (editing) {
    const close = () => setEditing(null);
    return (
      <ModeEditor
        mode={editing.mode}
        isNew={editing.isNew}
        onCancel={close}
        onSave={(mode) => {
          const nextModes = editing.isNew
            ? [...modes, mode]
            : modes.map((m) => (m.id === mode.id ? mode : m));
          // A mode that is on and now shares a day with another one that is on wins that day.
          setNotice(null);
          props.onSave({
            modes: nextModes,
            activeModeIds: activeModeIds.includes(mode.id)
              ? turnOn(nextModes, mode)
              : activeModeIds,
          });
          close();
        }}
        onDelete={() => {
          setNotice(null);
          props.onSave({
            modes: modes.filter((m) => m.id !== editing.mode.id),
            activeModeIds: activeModeIds.filter((id) => id !== editing.mode.id),
          });
          close();
        }}
      />
    );
  }

  return (
    <main className="screen settings">
      <header className="idle-header">
        <BackButton label={msg.common.toSettings} onClick={props.onBack} />
        <span className="brand">{msg.modes.title}</span>
        <button
          type="button"
          className="link header-add"
          aria-label={msg.modes.add}
          onClick={() => setEditing({ mode: newMode(), isNew: true })}
        >
          +
        </button>
      </header>
      <section className={`mode-status${schedule.allowed ? "" : " quiet"}`}>
        <span className="mode-status-name">
          {msg.modes.today(
            dayName(new Date().getDay() as Weekday),
            today?.name ?? msg.modes.anyTime,
          )}
        </span>
        <span>{describeRingState(schedule, new Date())}</span>
      </section>
      {modes.length > 0 ? (
        <ul className="mode-list">
          {modes.map((mode) => {
            const on = activeModeIds.includes(mode.id);
            return (
              <li key={mode.id} className={on ? "mode-row on" : "mode-row"}>
                <button
                  type="button"
                  className="mode-item"
                  onClick={() => setEditing({ mode, isNew: false })}
                >
                  <span className={`mode-item-time${mode.ranges.length > 1 ? " many" : ""}`}>
                    {describeRanges(mode)}
                  </span>
                  <span className="mode-item-meta">
                    {mode.name} · {describeDays(mode.days)} · {msg.modes.rule[mode.rule]}
                  </span>
                </button>
                <Switch
                  checked={on}
                  label={mode.name}
                  onChange={(checked) => {
                    if (!checked) setNotice(null);
                    props.onSave({
                      activeModeIds: checked
                        ? turnOn(modes, mode)
                        : activeModeIds.filter((id) => id !== mode.id),
                    });
                  }}
                />
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="mode-empty muted">{msg.modes.empty}</p>
      )}
      {notice && <p className="mode-notice warn">{notice}</p>}
      <p className="mode-footnote muted">{msg.modes.footnote}</p>
    </main>
  );
}

export function Switch(props: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      className="switch"
      onClick={() => props.onChange(!props.checked)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** Which time the wheel is editing: start or end of one range. */
interface WheelFocus {
  range: number;
  end: keyof TimeRange;
}

function ModeEditor(props: {
  mode: CallMode;
  isNew: boolean;
  onCancel: () => void;
  onSave: (mode: CallMode) => void;
  onDelete: () => void;
}) {
  const msg = useT();
  const [mode, setMode] = useState(props.mode);
  const [focus, setFocus] = useState<WheelFocus>({ range: 0, end: "start" });
  const [error, setError] = useState<string | null>(null);

  const update = (change: (m: CallMode) => CallMode) => {
    setMode(change);
    setError(null);
  };
  const setTime = (at: WheelFocus, time: string) =>
    update((m) => ({
      ...m,
      ranges: m.ranges.map((r, i) => (i === at.range ? { ...r, [at.end]: time } : r)),
    }));

  function submit(e: FormEvent) {
    e.preventDefault();
    const cleaned = { ...mode, name: mode.name.trim() };
    const problem = modeProblem(cleaned);
    if (problem) {
      setError(problem);
      return;
    }
    props.onSave(cleaned);
  }

  return (
    <form className="screen settings mode-editor" onSubmit={submit}>
      <header className="idle-header">
        <button type="button" className="link" onClick={props.onCancel}>
          {msg.common.cancel}
        </button>
        <span className="brand">{props.isNew ? msg.modes.newTitle : msg.modes.editTitle}</span>
        <button type="submit" className="link header-save">
          {msg.modes.store}
        </button>
      </header>

      <section className="range-list">
        {mode.ranges.map((range, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: ranges have no identity of their own
          <div key={i} className="range-card">
            <div className="range-ends">
              <RangeEnd
                label={msg.modes.start}
                time={range.start}
                current={focus.range === i && focus.end === "start"}
                onSelect={() => setFocus({ range: i, end: "start" })}
              />
              <span className="range-dash">–</span>
              <RangeEnd
                label={range.end < range.start ? msg.modes.endNextDay : msg.modes.end}
                time={range.end}
                current={focus.range === i && focus.end === "end"}
                onSelect={() => setFocus({ range: i, end: "end" })}
              />
            </div>
            {focus.range === i && (
              <TimeWheel value={range[focus.end]} onChange={(time) => setTime(focus, time)} />
            )}
            {mode.ranges.length > 1 && (
              <button
                type="button"
                className="link danger range-remove"
                onClick={() => {
                  update((m) => ({ ...m, ranges: m.ranges.filter((_, j) => j !== i) }));
                  setFocus({ range: 0, end: "start" });
                }}
              >
                {msg.modes.removeRange}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="pill"
          onClick={() => {
            update((m) => ({ ...m, ranges: [...m.ranges, NEW_RANGE] }));
            setFocus({ range: mode.ranges.length, end: "start" });
          }}
        >
          {msg.modes.addRange}
        </button>
      </section>

      <section className="repeat-section">
        <span className="section-label">
          {msg.modes.repeat}{" "}
          <span className="muted">
            {mode.days.length > 0 ? describeDays(mode.days) : msg.modes.noDays}
          </span>
        </span>
        <div className="day-picker">
          {WEEK.map((day) => {
            const on = mode.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                className={on ? "current" : undefined}
                aria-pressed={on}
                aria-label={dayName(day)}
                onClick={() =>
                  update((m) => ({
                    ...m,
                    days: on ? m.days.filter((d) => d !== day) : [...m.days, day],
                  }))
                }
              >
                {dayChar(day)}
              </button>
            );
          })}
        </div>
        {mode.ranges.some((r) => r.end < r.start) && mode.days.length < 7 && (
          <p className="muted">{msg.modes.overnight}</p>
        )}
      </section>

      <section className="rule-section">
        <div className="segmented">
          {RULES.map((rule) => (
            <label key={rule} className={mode.rule === rule ? "current" : undefined}>
              <input
                type="radio"
                name="rule"
                checked={mode.rule === rule}
                onChange={() => update((m) => ({ ...m, rule }))}
              />
              {msg.modes.rule[rule]}
            </label>
          ))}
        </div>
        <p className="muted">{msg.modes.ruleHint[mode.rule]}</p>
      </section>

      <ul className="editor-group">
        <li>
          <label className="settings-row">
            <span className="settings-row-label">{msg.modes.name}</span>
            <input
              className="row-input"
              value={mode.name}
              maxLength={MODE_NAME_MAX}
              placeholder={msg.modes.namePlaceholder}
              onChange={(e) => update((m) => ({ ...m, name: e.target.value }))}
            />
          </label>
        </li>
      </ul>

      {error && <p className="warn">{error}</p>}

      {!props.isNew && (
        <button type="button" className="delete-mode" onClick={props.onDelete}>
          {msg.modes.delete}
        </button>
      )}
    </form>
  );
}

function RangeEnd(props: { label: string; time: string; current: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`range-end${props.current ? " current" : ""}`}
      aria-pressed={props.current}
      onClick={props.onSelect}
    >
      <span className="range-end-label">{props.label}</span>
      <span className="range-end-time">{props.time}</span>
    </button>
  );
}

const pad = (n: number) => String(n).padStart(2, "0");
const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 60 }, (_, i) => pad(i));

/** Alarm-style hour and minute wheels for one "HH:MM"; scroll, drag or click a number. */
function TimeWheel(props: { value: string; onChange: (time: string) => void }) {
  const value = { hour: props.value.slice(0, 2), minute: props.value.slice(3, 5) };
  return (
    <div className="time-wheel">
      <Picker
        value={value}
        onChange={(v) => props.onChange(`${v.hour}:${v.minute}`)}
        wheelMode="normal"
        height={180}
        itemHeight={40}
      >
        <Picker.Column name="hour">
          {HOURS.map((h) => (
            <Picker.Item key={h} value={h}>
              {({ selected }) => (
                <span className={selected ? "wheel-selected" : undefined}>{h}</span>
              )}
            </Picker.Item>
          ))}
        </Picker.Column>
        <span className="wheel-colon">:</span>
        <Picker.Column name="minute">
          {MINUTES.map((m) => (
            <Picker.Item key={m} value={m}>
              {({ selected }) => (
                <span className={selected ? "wheel-selected" : undefined}>{m}</span>
              )}
            </Picker.Item>
          ))}
        </Picker.Column>
      </Picker>
    </div>
  );
}
