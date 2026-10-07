import { type CallMode, modesOn, normalizeModes, normalizeOnIds } from "./callModes.ts";
import { isLanguagePref, type LanguagePref } from "./i18n/index.ts";
import type { LlmSettings } from "./llm/qa.ts";
import {
  type CustomRingtone,
  normalizeCustomRingtones,
  normalizeRingtones,
  type RingtoneSettings,
} from "./ringtones.ts";
import type { ServerSettings } from "./serverClient.ts";
import { isSpeechLanguagePref, type SpeechLanguagePref } from "./voice/index.ts";
import { normalizeTts, type TtsSettings } from "./voice/tts/settings.ts";

const KEY = "outbrief.settings";

/** What the assistant calls the user until they pick their own 称呼. */
export const DEFAULT_ADDRESS_NAME = "老板";
export const ADDRESS_NAME_MAX = 20;

/**
 * The rate slider: Azure SSML `<prosody rate>` is "within 0.5 to 2 times the original audio"
 * (speech-synthesis-markup-voice); other engines clamp it to what their API takes.
 */
export const RATE_MIN = 0.5;
export const RATE_MAX = 2;

/**
 * Everything the user configures, kept only on this device. There is no login: `token` is this
 * device's own token in an anonymous account (outbrief-server ADR 0008), empty until the device
 * created or joined one.
 */
export interface AppSettings extends ServerSettings {
  /** The account and this device in it; empty until the device created or joined one. */
  accountId: string;
  deviceId: string;
  /**
   * The computer whose daemon settings (Multica, brief LLM) this device changes through the server
   * when there is no daemon on this machine; null: the first one that is online.
   */
  daemonId: string | null;
  /** UI language (设置 → 语言); "system" follows the system's language. */
  language: LanguagePref;
  /**
   * Language of briefs, their voice and in-call answers (设置 → 语音 → 汇报语言); "system" follows
   * the system's language. Separate from the UI `language`.
   */
  speechLanguage: SpeechLanguagePref;
  /**
   * The speech engine (设置 → 语音: a built-in one or the user's own HTTP request) and what was
   * saved for each engine: keys, model, voice. Keys stay on this device.
   */
  tts: TtsSettings;
  /** Speaking-rate multiplier, `RATE_MIN`..`RATE_MAX`. */
  rate: number;
  /** The user's own OpenAI-compatible endpoint for in-call Q&A; stays on this device. */
  llm: LlmSettings;
  /** How the assistant addresses the user in briefs and answers, e.g. "李哥". */
  addressName: string;
  /**
   * End-to-end key (`obk1_…`, see `src/e2e/`); empty until known. Calls are opened and replies
   * sealed with it; the server never has it.
   */
  e2eKey: string;
  /**
   * true: follow the key of the outbrief-daemon on this machine (fetched on start, the default).
   * false: this device's own copy (from a scanned QR code / pairing link, a passphrase, or the random
   * key of an account this app created), e.g. a phone.
   */
  e2eFromDaemon: boolean;
  /** Ringing schedules the user can switch between (设置 → 模式). */
  modes: CallMode[];
  /** Ids of the modes that are on, at most one per day of the week; none: 随时响铃. */
  activeModeIds: string[];
  /** 设置 → 铃声: the tone of an incoming call and of waiting while 呼叫 Agent creates the issue. */
  ringtones: RingtoneSettings;
  /** Tones the user added; their audio is in IndexedDB (`src/ringtoneStore.ts`) on this device. */
  customRingtones: CustomRingtone[];
  /**
   * 设置 → 后台来电 (Android): a foreground service keeps receiving calls while the app is in the
   * background or the phone is locked (OUTB-60). On unless switched off.
   */
  backgroundCalls: boolean;
}

interface StoredSettings {
  serverUrl?: string;
  /**
   * This device's token. Before accounts it held the server's one shared token, which the server
   * no longer accepts: only device tokens (`oba_…`) are kept.
   */
  token?: string;
  accountId?: string;
  deviceId?: string;
  daemonId?: string | null;
  /** Set by the removed Google login. */
  user?: unknown;
  language?: unknown;
  speechLanguage?: unknown;
  tts?: unknown;
  /** Saved before engines: the Azure voice. */
  voice?: string;
  rate?: number;
  llm?: Partial<LlmSettings>;
  addressName?: string;
  e2eKey?: string;
  e2eFromDaemon?: boolean;
  modes?: unknown;
  activeModeIds?: unknown;
  ringtones?: unknown;
  customRingtones?: unknown;
  backgroundCalls?: boolean;
  /** Saved before modes had 重复 days: the one mode in use. */
  activeModeId?: string | null;
}

/** Build-time defaults (VITE_OUTBRIEF_*), used only for what nothing has been saved for. */
export interface EnvDefaults {
  serverUrl?: string;
  /**
   * The claim code of an unowned local server (`pnpm dev:all` reads it from the server's log), so
   * the first account is created without asking.
   */
  claimCode?: string;
  llm?: Partial<LlmSettings>;
}

/** The server address when none is saved and the build sets none. */
export const DEFAULT_SERVER_URL = "http://localhost:8787";

/** Device tokens; anything else saved as `token` is the old shared token or a login session. */
const DEVICE_TOKEN = /^oba_/;

/**
 * Saved settings over build-time defaults. `env.serverUrl` (VITE_OUTBRIEF_SERVER_URL) fills the
 * address only when none is saved; `env.llm` (VITE_OUTBRIEF_LLM_*) fills the LLM endpoint only
 * until one is saved. The shared token of old versions is dropped: the device creates or joins an
 * account instead (a desktop app through its local daemon, so it lands in the same account).
 */
export function resolveSettings(stored: StoredSettings | null, env: EnvDefaults = {}): AppSettings {
  const savedUrl = stored?.serverUrl?.trim();
  const rate = typeof stored?.rate === "number" ? stored.rate : 1;
  const savedToken = stored?.token?.trim() ?? "";
  const token = DEVICE_TOKEN.test(savedToken) ? savedToken : "";
  const modes = normalizeModes(stored?.modes);
  const customRingtones = normalizeCustomRingtones(stored?.customRingtones);
  return {
    serverUrl: savedUrl || env.serverUrl?.trim() || DEFAULT_SERVER_URL,
    token,
    accountId: token ? (stored?.accountId ?? "") : "",
    deviceId: token ? (stored?.deviceId ?? "") : "",
    daemonId: stored?.daemonId ?? null,
    language: isLanguagePref(stored?.language) ? stored.language : "system",
    speechLanguage: isSpeechLanguagePref(stored?.speechLanguage) ? stored.speechLanguage : "system",
    tts: normalizeTts(stored?.tts, stored?.voice),
    rate: Math.min(RATE_MAX, Math.max(RATE_MIN, rate)),
    llm: resolveLlm(stored?.llm, env.llm),
    addressName: normalizeAddressName(stored?.addressName),
    e2eKey: stored?.e2eKey?.trim() ?? "",
    e2eFromDaemon: stored?.e2eFromDaemon ?? true,
    modes,
    activeModeIds: normalizeOnIds(
      modes,
      stored?.activeModeIds ?? (stored?.activeModeId ? [stored.activeModeId] : []),
    ),
    ringtones: normalizeRingtones(stored?.ringtones, customRingtones),
    customRingtones,
    backgroundCalls: stored?.backgroundCalls ?? true,
  };
}

/** The modes that are on; none means 随时响铃. */
export function activeModes(s: AppSettings): CallMode[] {
  return modesOn(s.modes, s.activeModeIds);
}

/** The server connection, or null until this device has created or joined an account. */
export function serverOf(s: AppSettings): ServerSettings | null {
  const serverUrl = s.serverUrl.trim();
  const token = s.token.trim();
  return token && /^https?:\/\/[^/]/.test(serverUrl) && URL.canParse(serverUrl)
    ? { serverUrl, token }
    : null;
}

/**
 * A saved endpoint wins as a whole, so a key cleared on purpose stays empty; the env defaults only
 * apply while every saved field is blank.
 */
function resolveLlm(
  saved: Partial<LlmSettings> | undefined,
  env: Partial<LlmSettings> | undefined,
): LlmSettings {
  const trimmed = (from: Partial<LlmSettings> | undefined): LlmSettings => ({
    baseUrl: from?.baseUrl?.trim() ?? "",
    apiKey: from?.apiKey?.trim() ?? "",
    model: from?.model?.trim() ?? "",
    structuredOutput: from?.structuredOutput === "json_object" ? "json_object" : "json_schema",
  });
  const own = trimmed(saved);
  return own.baseUrl || own.apiKey || own.model ? own : trimmed(env);
}

/** Trimmed and capped; blank means the default 称呼. */
export function normalizeAddressName(value: string | undefined): string {
  return value?.trim().slice(0, ADDRESS_NAME_MAX) || DEFAULT_ADDRESS_NAME;
}

function readStored(): StoredSettings | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null") as StoredSettings | null;
  } catch {
    return null;
  }
}

function envDefaults(): EnvDefaults {
  const env = import.meta.env as Record<string, string | undefined>;
  const llm = {
    baseUrl: env.VITE_OUTBRIEF_LLM_BASE_URL,
    apiKey: env.VITE_OUTBRIEF_LLM_API_KEY,
    model: env.VITE_OUTBRIEF_LLM_MODEL,
  };
  return {
    serverUrl: env.VITE_OUTBRIEF_SERVER_URL,
    claimCode: env.VITE_OUTBRIEF_CLAIM_CODE,
    llm,
  };
}

/** Build-time defaults, e.g. the claim code of a local dev server. */
export function loadEnvDefaults(): EnvDefaults {
  return envDefaults();
}

export function loadSettings(): AppSettings {
  return resolveSettings(readStored(), envDefaults());
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
