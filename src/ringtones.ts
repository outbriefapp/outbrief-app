import type { Locale } from "./i18n/index.ts";

/** What a ringtone is for: an agent calling in, or waiting while 呼叫 Agent creates the issue. */
export type RingPurpose = "incoming" | "dispatch";

export const RING_PURPOSES: RingPurpose[] = ["incoming", "dispatch"];

/** A tone shipped with the app, under `public/ringtones/`. */
export interface BuiltinRingtone {
  id: string;
  file: string;
  name: Record<Locale, string>;
}

export const BUILTIN_RINGTONES: BuiltinRingtone[] = [
  { id: "classic", file: "/ringtones/classic.mp3", name: { zh: "经典", en: "Classic" } },
  // The Chinese ringback tone: 450 Hz, 1 s on, 4 s off (YD/T 1970).
  { id: "ringback", file: "/ringtones/ringback.mp3", name: { zh: "回铃音", en: "Ringback" } },
  { id: "chime", file: "/ringtones/chime.mp3", name: { zh: "叮咚", en: "Chime" } },
  { id: "marimba", file: "/ringtones/marimba.mp3", name: { zh: "马林巴", en: "Marimba" } },
  { id: "digital", file: "/ringtones/digital.mp3", name: { zh: "电子", en: "Digital" } },
  { id: "soft", file: "/ringtones/soft.mp3", name: { zh: "柔和", en: "Soft" } },
];

/** No sound: only offered while waiting for a dispatch, a call always rings. */
export const SILENT = "none";

/** Ids of the user's own tones (kept in IndexedDB) start with this. */
const CUSTOM_PREFIX = "custom:";

/** Out of the box: calls ring as before, waiting for a dispatch sounds like calling someone. */
export const DEFAULT_RINGTONES: Record<RingPurpose, string> = {
  incoming: "classic",
  dispatch: "ringback",
};

/** 设置 → 铃声: what plays for each purpose — a built-in id, a custom id, or `SILENT`. */
export type RingtoneSettings = Record<RingPurpose, string>;

/** A tone the user added, as listed in settings; the audio itself stays in IndexedDB. */
export interface CustomRingtone {
  id: string;
  name: string;
}

/** Custom tones up to this size, a few minutes of MP3; what plays is looped anyway. */
export const CUSTOM_RINGTONE_MAX_BYTES = 10 * 1024 * 1024;

export function customRingtoneId(): string {
  return `${CUSTOM_PREFIX}${crypto.randomUUID()}`;
}

export function isCustomRingtone(id: string): boolean {
  return id.startsWith(CUSTOM_PREFIX);
}

export function builtinRingtone(id: string): BuiltinRingtone | undefined {
  return BUILTIN_RINGTONES.find((r) => r.id === id);
}

/** Whether `purpose` may be set to `id` with these custom tones. */
export function isRingtoneChoice(
  purpose: RingPurpose,
  id: string,
  custom: readonly CustomRingtone[],
): boolean {
  if (id === SILENT) return purpose === "dispatch";
  return builtinRingtone(id) !== undefined || custom.some((c) => c.id === id);
}

/**
 * Saved choices, each falling back to its default when it is missing, unknown, or a custom tone
 * that is no longer there (removed in settings).
 */
export function normalizeRingtones(
  stored: unknown,
  custom: readonly CustomRingtone[],
): RingtoneSettings {
  const saved = (stored && typeof stored === "object" ? stored : {}) as Record<string, unknown>;
  const pick = (purpose: RingPurpose): string => {
    const id = saved[purpose];
    return typeof id === "string" && isRingtoneChoice(purpose, id, custom)
      ? id
      : DEFAULT_RINGTONES[purpose];
  };
  return { incoming: pick("incoming"), dispatch: pick("dispatch") };
}

/** The saved list of custom tones, dropping anything malformed. */
export function normalizeCustomRingtones(stored: unknown): CustomRingtone[] {
  if (!Array.isArray(stored)) return [];
  return stored.flatMap((c: unknown) => {
    const { id, name } = (c ?? {}) as Partial<CustomRingtone>;
    return typeof id === "string" && isCustomRingtone(id) && typeof name === "string"
      ? [{ id, name }]
      : [];
  });
}

/** After custom tones are removed: what used one of them goes back to its default. */
export function withoutCustomRingtones(
  ringtones: RingtoneSettings,
  ids: readonly string[],
): RingtoneSettings {
  const keep = (purpose: RingPurpose) =>
    ids.includes(ringtones[purpose]) ? DEFAULT_RINGTONES[purpose] : ringtones[purpose];
  return { incoming: keep("incoming"), dispatch: keep("dispatch") };
}

/** The other purpose, when it uses `id` too: "等待铃声在用" next to it on the incoming page. */
export function usedByOther(
  ringtones: RingtoneSettings,
  purpose: RingPurpose,
  id: string,
): RingPurpose | null {
  const other: RingPurpose = purpose === "incoming" ? "dispatch" : "incoming";
  return ringtones[other] === id ? other : null;
}

/** A purpose's page shows a search box once it lists more tones than this. */
export const SEARCH_FROM = 8;

/** My tones shown before 显示全部, newest first. */
export const CUSTOM_SHOWN = 5;

export const RINGTONE_NAME_MAX = 40;

/** Tones whose name contains the query, ignoring case and surrounding spaces. */
export function matchRingtones<T extends { name: string }>(list: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  return q ? list.filter((r) => r.name.toLowerCase().includes(q)) : [...list];
}

/** Custom tones are saved in the order they were added; the pages list the newest first. */
export function newestFirst(list: readonly CustomRingtone[]): CustomRingtone[] {
  return [...list].reverse();
}

/** Renamed, trimmed and capped; a blank name keeps the old one. */
export function renameCustomRingtone(
  list: readonly CustomRingtone[],
  id: string,
  name: string,
): CustomRingtone[] {
  const next = name.trim().slice(0, RINGTONE_NAME_MAX);
  return list.map((c) => (c.id === id && next ? { ...c, name: next } : c));
}

/** Why a picked file cannot be a ringtone, or null when it can. */
export function ringtoneFileProblem(file: {
  type: string;
  size: number;
}): "notAudio" | "tooBig" | null {
  if (!file.type.startsWith("audio/")) return "notAudio";
  if (file.size > CUSTOM_RINGTONE_MAX_BYTES) return "tooBig";
  return null;
}

/** "晨光.mp3" → "晨光": the name shown in the list. */
export function ringtoneName(fileName: string): string {
  return (fileName.replace(/\.[^.]+$/, "").trim() || fileName).slice(0, RINGTONE_NAME_MAX);
}
