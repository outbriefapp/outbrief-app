import { Check, ChevronRight, Play, Plus, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "../format.ts";
import { type Messages, useT } from "../i18n/index.ts";
import { deleteRingtoneAudio, saveRingtoneAudio } from "../ringtoneStore.ts";
import {
  BUILTIN_RINGTONES,
  builtinRingtone,
  CUSTOM_RINGTONE_MAX_BYTES,
  CUSTOM_SHOWN,
  type CustomRingtone,
  customRingtoneId,
  DEFAULT_RINGTONES,
  matchRingtones,
  newestFirst,
  RING_PURPOSES,
  RINGTONE_NAME_MAX,
  type RingPurpose,
  renameCustomRingtone,
  ringtoneFileProblem,
  ringtoneName,
  SEARCH_FROM,
  SILENT,
  usedByOther,
  withoutCustomRingtones,
} from "../ringtones.ts";
import type { AppSettings } from "../settings.ts";
import { playRingtone } from "../useRingtone.ts";
import { BackButton } from "./BackButton.tsx";
import type { SettingsPatch } from "./SettingsForm.tsx";

const MAX_MB = CUSTOM_RINGTONE_MAX_BYTES / 1024 / 1024;

/** A ringtone's name in the UI language: 不响, a built-in's name, or what the user called theirs. */
export function ringtoneLabel(
  id: string,
  custom: readonly CustomRingtone[],
  msg: Messages,
): string {
  if (id === SILENT) return msg.ringtones.silent;
  return builtinRingtone(id)?.name[msg.locale] ?? custom.find((c) => c.id === id)?.name ?? id;
}

function purposeTitle(purpose: RingPurpose, msg: Messages): string {
  return purpose === "incoming" ? msg.ringtones.incoming : msg.ringtones.dispatch;
}

/**
 * 设置 → 铃声, like 电话铃声 on a phone: first the two purposes, each with the tone it uses now; each
 * opens its own page to pick, add and manage tones, so the list never mixes the two however many
 * tones there are.
 */
export function RingtonesPage(props: {
  settings: AppSettings;
  onSave: (patch: SettingsPatch) => void;
  onBack: () => void;
}) {
  const msg = useT();
  const [purpose, setPurpose] = useState<RingPurpose | null>(null);
  const { ringtones, customRingtones } = props.settings;

  if (purpose) {
    return (
      <RingtonePicker
        purpose={purpose}
        settings={props.settings}
        onSave={props.onSave}
        onBack={() => setPurpose(null)}
      />
    );
  }

  return (
    <main className="screen settings">
      <header className="idle-header">
        <BackButton label={msg.common.toSettings} onClick={props.onBack} />
        <span className="brand">{msg.settings.page.ringtones}</span>
        <span className="header-spacer" />
      </header>
      <section className="settings-group">
        <ul>
          {RING_PURPOSES.map((p) => (
            <li key={p}>
              <button type="button" className="settings-row" onClick={() => setPurpose(p)}>
                <span className="settings-row-label">{purposeTitle(p, msg)}</span>
                <span className="settings-row-value">
                  {ringtoneLabel(ringtones[p], customRingtones, msg)}
                </span>
                <ChevronRight size={16} className="settings-row-chevron" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <p className="muted ringtone-hint">{msg.ringtones.incomingHint}</p>
        <p className="muted ringtone-hint">{msg.ringtones.dispatchHint}</p>
      </section>
    </main>
  );
}

/**
 * One purpose's tones: the current one pinned on top, a search box once there are many, then 我的铃声
 * (newest first, the first few until 显示全部; a tone added here is used for this purpose) and the
 * built-in ones. Tapping plays a tone once and picks it. 编辑 renames and removes, several at once.
 */
function RingtonePicker(props: {
  purpose: RingPurpose;
  settings: AppSettings;
  onSave: (patch: SettingsPatch) => void;
  onBack: () => void;
}) {
  const msg = useT();
  const m = msg.ringtones;
  const { purpose } = props;
  const { ringtones, customRingtones } = props.settings;
  const current = ringtones[purpose];
  const stopPreview = useRef<(() => void) | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => () => stopPreview.current?.(), []);

  const preview = (id: string) => {
    stopPreview.current?.();
    stopPreview.current = playRingtone(id, false);
  };

  const pick = (id: string) => {
    preview(id);
    if (current !== id) props.onSave({ ringtones: { ...ringtones, [purpose]: id } });
  };

  /** Adds the picked files in order; the last one added is what this purpose uses now. */
  const add = (files: File[]) => {
    setProblem(null);
    const rejected = files.map(ringtoneFileProblem).find((why) => why !== null);
    if (rejected) setProblem(rejected === "tooBig" ? m.tooBig(MAX_MB) : m.notAudio);
    const accepted = files.filter((f) => ringtoneFileProblem(f) === null);
    if (!accepted.length) return;
    const tones = accepted.map((file) => ({
      file,
      tone: { id: customRingtoneId(), name: ringtoneName(file.name) } as CustomRingtone,
    }));
    setAdding(true);
    Promise.all(tones.map(({ file, tone }) => saveRingtoneAudio(tone.id, file)))
      .then(
        () => {
          const last = tones[tones.length - 1]?.tone;
          if (!last) return;
          // Added on this purpose's page: it is what this purpose uses now.
          props.onSave({
            customRingtones: [...customRingtones, ...tones.map((t) => t.tone)],
            ringtones: { ...ringtones, [purpose]: last.id },
          });
          setQuery("");
          preview(last.id);
        },
        (err: unknown) => {
          console.warn("[outbrief] add ringtone", err);
          setProblem(m.addFailed(errorMessage(err)));
        },
      )
      .finally(() => setAdding(false));
  };

  const removeChecked = () => {
    const ids = checked;
    if (!ids.length) return;
    const notes = RING_PURPOSES.filter((p) => ids.includes(ringtones[p])).map((p) =>
      m.inUse(
        ringtoneLabel(ringtones[p], customRingtones, msg),
        purposeTitle(p, msg),
        ringtoneLabel(DEFAULT_RINGTONES[p], customRingtones, msg),
      ),
    );
    if (notes.length && !window.confirm(m.confirmRemove(notes))) return;
    setProblem(null);
    stopPreview.current?.();
    Promise.all(ids.map(deleteRingtoneAudio)).then(
      () => {
        const left = customRingtones.filter((c) => !ids.includes(c.id));
        props.onSave({
          customRingtones: left,
          ringtones: withoutCustomRingtones(ringtones, ids),
        });
        setChecked([]);
        if (!left.length) setEditing(false);
      },
      (err: unknown) => {
        console.warn("[outbrief] remove ringtone", err);
        setProblem(m.removeFailed(errorMessage(err)));
      },
    );
  };

  const builtins = BUILTIN_RINGTONES.map((r) => ({ id: r.id, name: r.name[msg.locale] }));
  const mine = newestFirst(customRingtones);
  const searchable = builtins.length + mine.length > SEARCH_FROM;
  const q = searchable ? query : "";
  const mineMatched = matchRingtones(mine, q);
  const builtinsMatched = matchRingtones(builtins, q);
  const folded = !q && !editing && !expanded && mineMatched.length > CUSTOM_SHOWN;
  const mineShown = folded ? mineMatched.slice(0, CUSTOM_SHOWN) : mineMatched;

  const row = (tone: { id: string; name: string }) => {
    const other = usedByOther(ringtones, purpose, tone.id);
    return (
      <li key={tone.id}>
        <button
          type="button"
          className="settings-row"
          aria-pressed={current === tone.id}
          onClick={() => pick(tone.id)}
        >
          <span className="settings-row-label ringtone-name">{tone.name}</span>
          {current === tone.id ? (
            <Check size={16} className="ringtone-check" aria-hidden />
          ) : (
            other && <span className="ringtone-tag">{m.usedBy[other]}</span>
          )}
        </button>
      </li>
    );
  };

  return (
    <main className="screen settings ringtone-picker">
      <header className="idle-header">
        <BackButton label={msg.settings.page.ringtones} onClick={props.onBack} />
        <span className="brand">{purposeTitle(purpose, msg)}</span>
        {mine.length > 0 ? (
          <button
            type="button"
            className="link header-edit"
            onClick={() => {
              setEditing(!editing);
              setChecked([]);
              setProblem(null);
            }}
          >
            {editing ? m.done : m.edit}
          </button>
        ) : (
          <span className="header-spacer" />
        )}
      </header>
      <div className="ringtone-sticky">
        <div className="ringtone-current">
          <span className="muted">{m.current}</span>
          <span className="ringtone-name">{ringtoneLabel(current, customRingtones, msg)}</span>
          {current !== SILENT && (
            <button
              type="button"
              className="icon-button"
              aria-label={m.playCurrent(ringtoneLabel(current, customRingtones, msg))}
              title={m.playCurrent(ringtoneLabel(current, customRingtones, msg))}
              onClick={() => preview(current)}
            >
              <Play size={16} aria-hidden />
            </button>
          )}
        </div>
        {searchable && (
          <label className="ringtone-search">
            <Search size={16} aria-hidden />
            <input
              type="search"
              value={query}
              placeholder={m.search}
              aria-label={m.search}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
        )}
      </div>
      {editing ? (
        <p className="muted ringtone-hint">{m.editHint}</p>
      ) : (
        <p className="muted ringtone-hint">{m.preview}</p>
      )}
      {purpose === "dispatch" && !editing && !q && (
        <section className="settings-group">
          <ul>{row({ id: SILENT, name: m.silent })}</ul>
        </section>
      )}
      <section className="settings-group">
        <h2>{m.custom(mine.length)}</h2>
        <ul>
          {!editing && (
            <li>
              <button
                type="button"
                className="settings-row ringtone-add"
                disabled={adding}
                onClick={() => fileInput.current?.click()}
              >
                <Plus size={16} aria-hidden />
                <span className="settings-row-label">{adding ? m.adding : m.add}</span>
              </button>
            </li>
          )}
          {editing
            ? mineShown.map((tone) => (
                <EditRow
                  key={tone.id}
                  tone={tone}
                  checked={checked.includes(tone.id)}
                  onCheck={(on) =>
                    setChecked((ids) =>
                      on ? [...ids, tone.id] : ids.filter((id) => id !== tone.id),
                    )
                  }
                  onRename={(name) =>
                    props.onSave({
                      customRingtones: renameCustomRingtone(customRingtones, tone.id, name),
                    })
                  }
                />
              ))
            : mineShown.map(row)}
          {(folded || (expanded && !q && mineMatched.length > CUSTOM_SHOWN)) && !editing && (
            <li>
              <button
                type="button"
                className="settings-row ringtone-more"
                onClick={() => setExpanded(!expanded)}
              >
                <span className="settings-row-label">
                  {folded ? m.showAll(mineMatched.length) : m.showLess}
                </span>
              </button>
            </li>
          )}
        </ul>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            // Picking the same file again after removing it must fire `change` again.
            e.target.value = "";
            if (files.length) add(files);
          }}
        />
        {problem ? (
          <p className="hint-line warn">{problem}</p>
        ) : (
          !editing && <p className="muted ringtone-hint">{m.addHint(MAX_MB)}</p>
        )}
        {editing && (
          <button
            type="button"
            className="pill wide ringtone-remove"
            disabled={!checked.length}
            onClick={removeChecked}
          >
            {m.removeSelected(checked.length)}
          </button>
        )}
      </section>
      {!editing && builtinsMatched.length > 0 && (
        <section className="settings-group">
          <h2>{m.builtin}</h2>
          <ul>{builtinsMatched.map(row)}</ul>
        </section>
      )}
      {q && !mineMatched.length && !builtinsMatched.length && (
        <p className="hint-line">{m.noMatch}</p>
      )}
    </main>
  );
}

/** 编辑: a checkbox to remove the tone with others, and its name to rename in place. */
function EditRow(props: {
  tone: CustomRingtone;
  checked: boolean;
  onCheck: (checked: boolean) => void;
  onRename: (name: string) => void;
}) {
  const m = useT().ringtones;
  const [name, setName] = useState(props.tone.name);
  useEffect(() => setName(props.tone.name), [props.tone.name]);
  const commit = () => {
    if (name.trim() && name.trim() !== props.tone.name) props.onRename(name);
    else setName(props.tone.name);
  };
  return (
    <li className="ringtone-edit-row">
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={m.select(props.tone.name)}
        onChange={(e) => props.onCheck(e.target.checked)}
      />
      <input
        type="text"
        value={name}
        maxLength={RINGTONE_NAME_MAX}
        aria-label={m.rename(props.tone.name)}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </li>
  );
}
