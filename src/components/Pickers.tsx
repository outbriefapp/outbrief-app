import { Check, ChevronDown } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useDismiss } from "../useDismiss.ts";

/** One choice in a `PresetPicker`: its name and a second, muted line (a host, "免费"…). */
export interface PresetItem {
  id: string;
  name: string;
  detail: string;
}

/**
 * Built-in services as one compact dropdown (name and detail per row, filterable), so a page stays
 * short however many services are added (设置 → 大模型, 设置 → 语音).
 */
export function PresetPicker(props: {
  items: readonly PresetItem[];
  value: string;
  onChange: (id: string) => void;
  searchPlaceholder: string;
  noMatch: string;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, ref, close);
  const current = props.items.find((p) => p.id === props.value);
  const query = filter.trim().toLowerCase();
  const shown = props.items.filter(
    (p) => !query || p.name.toLowerCase().includes(query) || p.detail.toLowerCase().includes(query),
  );

  return (
    <div className="provider-picker" ref={ref}>
      <button
        type="button"
        className="provider-current"
        aria-expanded={open}
        onClick={() => {
          setFilter("");
          setOpen((v) => !v);
        }}
      >
        <span className="provider-name">{current?.name}</span>
        <span className="provider-host">{current?.detail ?? ""}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <div className="model-menu provider-menu">
          <input
            className="provider-filter"
            value={filter}
            placeholder={props.searchPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            // biome-ignore lint/a11y/noAutofocus: the menu was just opened by the user
            autoFocus
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (shown[0]) {
                  props.onChange(shown[0].id);
                  setOpen(false);
                }
              }
            }}
          />
          <ul>
            {shown.length === 0 && <li className="model-empty">{props.noMatch}</li>}
            {shown.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={p.id === props.value ? "selected" : undefined}
                  onClick={() => {
                    props.onChange(p.id);
                    setOpen(false);
                  }}
                >
                  <span className="provider-name">{p.name}</span>
                  <span className="provider-host">{p.detail}</span>
                  {p.id === props.value && <Check size={14} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export interface ComboGroup {
  label: string;
  /** `label` is shown next to the id when it differs (a voice's name). */
  options: readonly { id: string; label?: string }[];
}

/**
 * A text field for an id with a filterable dropdown of known ids in groups (a provider's built-in
 * models, the ones its API lists…). Any other id can be typed in.
 */
export function ComboPicker(props: {
  value: string;
  groups: readonly ComboGroup[];
  onChange: (value: string) => void;
  placeholder: string;
  chooseLabel: string;
  noMatch: string;
  /**
   * Show the chosen option's name instead of its id while the field is not being edited (voices,
   * whose ids are codes like `zh_female_vv_uranus_bigtts`). The id is still what gets typed and
   * saved; focusing the field reveals it.
   */
  showNames?: boolean;
}) {
  const [open, setOpen] = useState(false);
  // Only filter once the user types; on focus the whole list shows.
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => {
    setOpen(false);
    setEditing(false);
  }, []);
  useDismiss(open, ref, close);
  const query = filter.trim().toLowerCase();
  const seen = new Set<string>();
  const groups = props.groups
    .map((g) => ({
      label: g.label,
      options: g.options.filter((o) => {
        if (seen.has(o.id)) return false;
        seen.add(o.id);
        return (
          !query || o.id.toLowerCase().includes(query) || !!o.label?.toLowerCase().includes(query)
        );
      }),
    }))
    .filter((g) => g.options.length > 0);
  const hasList = props.groups.some((g) => g.options.length > 0);
  const shown = groups.flatMap((g) => g.options);
  // The name of the chosen option, when it is one of the known ones.
  const chosen = props.groups.flatMap((g) => g.options).find((o) => o.id === props.value)?.label;
  const display = props.showNames && !editing && chosen ? chosen : props.value;

  return (
    <div className="model-picker" ref={ref}>
      <input
        value={display}
        placeholder={props.placeholder}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        onFocus={() => {
          setFilter("");
          setEditing(true);
          setOpen(hasList);
        }}
        onBlur={() => setEditing(false)}
        onChange={(e) => {
          props.onChange(e.target.value);
          setFilter(e.target.value);
          setOpen(hasList);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && open && shown.length === 1 && shown[0]) {
            e.preventDefault();
            props.onChange(shown[0].id);
            setOpen(false);
          }
        }}
      />
      {hasList && (
        <button
          type="button"
          className="icon-inside"
          aria-label={props.chooseLabel}
          tabIndex={-1}
          onClick={() => {
            setFilter("");
            setOpen((v) => !v);
          }}
        >
          <ChevronDown size={16} />
        </button>
      )}
      {open && (
        <ul className="model-menu">
          {shown.length === 0 && <li className="model-empty">{props.noMatch}</li>}
          {groups.map((g) => [
            groups.length > 1 || g.label ? (
              <li key={`group:${g.label}`} className="model-group">
                {g.label}
              </li>
            ) : null,
            ...g.options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className={o.id === props.value ? "selected" : undefined}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    props.onChange(o.id);
                    setOpen(false);
                  }}
                >
                  {o.label && o.label !== o.id ? (
                    <span className="option-named">
                      <span>{o.label}</span>
                      <span className="option-id">{o.id}</span>
                    </span>
                  ) : (
                    <span>{o.id}</span>
                  )}
                  {o.id === props.value && <Check size={14} />}
                </button>
              </li>
            )),
          ])}
        </ul>
      )}
    </div>
  );
}
