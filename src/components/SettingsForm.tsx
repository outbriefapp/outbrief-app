import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { AccountPatch } from "../account.ts";
import { type DaemonLink, daemonLabel, fetchMulticaSettings } from "../daemonLink.ts";
import {
  LANGUAGE_PREFS,
  type LanguagePref,
  type Locale,
  type Messages,
  systemLocale,
  t,
  useT,
} from "../i18n/index.ts";
import { llmConfigured } from "../llm/qa.ts";
import type { Device } from "../protocol.ts";
import {
  ADDRESS_NAME_MAX,
  type AppSettings,
  activeModes,
  DEFAULT_ADDRESS_NAME,
  normalizeAddressName,
  serverOf,
} from "../settings.ts";
import { resolveSpeechLanguage, speechLanguageName } from "../voice/index.ts";
import { ttsEngine } from "../voice/tts/registry.ts";
import { configOf, voiceFor } from "../voice/tts/settings.ts";
import { localized } from "../voice/tts/types.ts";
import { BackButton } from "./BackButton.tsx";
import { DevicesPage } from "./DevicesPage.tsx";
import { E2eSettingsSection, keySummary } from "./E2eSettingsSection.tsx";
import { LlmSettingsSection } from "./LlmSettingsSection.tsx";
import { ModesPage } from "./ModesPage.tsx";
import { MulticaSettingsSection } from "./MulticaSettingsSection.tsx";
import { RingtonesPage, ringtoneLabel } from "./RingtonesPage.tsx";
import { VoiceSettingsSection } from "./VoiceSettingsSection.tsx";

type Page = keyof Messages["settings"]["page"];

/** Each language by its own name, whatever the UI language is. */
const LANGUAGE_NAME: Record<Locale, string> = { zh: "中文", en: "English" };

/** Settings the user edits on this device (the Multica token lives in the local daemon). */
export type SettingsPatch = Partial<
  Pick<
    AppSettings,
    | "language"
    | "daemonId"
    | "speechLanguage"
    | "tts"
    | "rate"
    | "llm"
    | "addressName"
    | "e2eKey"
    | "e2eFromDaemon"
    | "modes"
    | "activeModeIds"
    | "ringtones"
    | "customRingtones"
  >
>;

/**
 * Settings as a grouped list; each row opens its own page. New settings add a row instead of
 * making one long form. Each page saves on its own.
 */
export function SettingsForm(props: {
  settings: AppSettings;
  /** Whether a usable end-to-end key is in place. */
  e2eReady: boolean;
  /** The daemon whose settings the Multica / LLM pages change; null when the account has none. */
  daemon: DaemonLink | null;
  /** The account's computers, when this device reaches them through the server (no local daemon). */
  daemons: Device[];
  onSave: (patch: SettingsPatch) => void;
  /** This device left its account (removed itself). */
  onLeft: () => void;
  /** This device moved to another account. */
  onSwitched: (patch: AccountPatch) => void;
  onClose: () => void;
  /** A page to open straight away (设置 → 模式 from the idle screen); back returns to the caller. */
  initialPage?: Page;
}) {
  const msg = useT();
  const { settings } = props;
  const server = serverOf(settings);
  const { daemon } = props;
  const [page, setPage] = useState<Page | null>(() => props.initialPage ?? null);
  const back = () =>
    props.initialPage && page === props.initialPage ? props.onClose() : setPage(null);
  const save = (patch: SettingsPatch) => {
    props.onSave(patch);
    setPage(null);
  };

  // Modes is a list with its own editor pages, like the alarm clock; it draws its own header.
  if (page === "modes") {
    return <ModesPage settings={settings} onSave={props.onSave} onBack={back} />;
  }
  // Ringtones has a page per purpose, like 电话铃声 on a phone; it draws its own header too.
  if (page === "ringtones") {
    return <RingtonesPage settings={settings} onSave={props.onSave} onBack={back} />;
  }

  if (page) {
    return (
      <main className="screen settings">
        <header className="idle-header">
          <BackButton label={msg.common.toSettings} onClick={back} />
          <span className="brand">{msg.settings.page[page]}</span>
          <span className="header-spacer" />
        </header>
        <div className="settings-page">
          {page === "devices" &&
            (server ? (
              <DevicesPage
                server={server}
                e2eKey={props.e2eReady ? settings.e2eKey : ""}
                onLeft={props.onLeft}
                onSwitched={props.onSwitched}
              />
            ) : (
              <NeedsServer />
            ))}
          {page === "e2e" && (
            <E2eSettingsSection
              localDaemon={daemon?.kind === "local" ? daemon : null}
              hasKey={props.e2eReady}
              onSave={props.onSave}
            />
          )}
          {page === "address" && (
            <AddressPage value={settings.addressName} onSave={save} onCancel={back} />
          )}
          {page === "multica" && (
            <>
              <DaemonPicker
                daemon={daemon}
                daemons={props.daemons}
                onPick={(daemonId) => props.onSave({ daemonId })}
              />
              {daemon && <MulticaSettingsSection daemon={daemon} />}
            </>
          )}
          {page === "voice" && (
            <VoiceSettingsSection settings={settings} onSave={save} onCancel={back} />
          )}
          {page === "llm" && (
            <>
              <DaemonPicker
                daemon={daemon}
                daemons={props.daemons}
                onPick={(daemonId) => props.onSave({ daemonId })}
              />
              <LlmSettingsSection
                value={settings.llm}
                daemon={daemon}
                onSave={(llm) => props.onSave({ llm })}
                onCancel={back}
              />
            </>
          )}
          {page === "language" && (
            <LanguagePage value={settings.language} onSave={save} onCancel={back} />
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="screen settings">
      <header className="idle-header">
        <BackButton onClick={props.onClose} />
        <span className="brand">{msg.settings.title}</span>
        <span className="header-spacer" />
      </header>
      <SettingsGroup title={msg.settings.group.general}>
        <SettingsRow
          label={msg.settings.page.language}
          value={languageSummary(settings.language)}
          onOpen={() => setPage("language")}
        />
      </SettingsGroup>
      <SettingsGroup title={msg.settings.group.connection}>
        <SettingsRow
          label={msg.settings.page.devices}
          value={serverSummary(settings)}
          onOpen={() => setPage("devices")}
        />
        <SettingsRow
          label={msg.settings.page.e2e}
          value={keySummary(settings.e2eFromDaemon, props.e2eReady)}
          onOpen={() => setPage("e2e")}
        />
      </SettingsGroup>
      <SettingsGroup title={msg.settings.group.personal}>
        <SettingsRow
          label={msg.settings.page.address}
          value={settings.addressName}
          onOpen={() => setPage("address")}
        />
      </SettingsGroup>
      <SettingsGroup title={msg.settings.group.integrations}>
        <SettingsRow
          label={msg.settings.page.multica}
          value={daemon ? <MulticaSummary daemon={daemon} /> : msg.common.notSet}
          onOpen={() => setPage("multica")}
        />
      </SettingsGroup>
      <SettingsGroup title={msg.settings.group.calls}>
        <SettingsRow
          label={msg.settings.page.modes}
          value={
            activeModes(settings)
              .map((m) => m.name)
              .join(msg.common.listSep) || msg.modes.anyTime
          }
          onOpen={() => setPage("modes")}
        />
        <SettingsRow
          label={msg.settings.page.ringtones}
          value={ringtoneSummary(settings)}
          onOpen={() => setPage("ringtones")}
        />
        <SettingsRow
          label={msg.settings.page.voice}
          value={voiceSummary(settings)}
          onOpen={() => setPage("voice")}
        />
        <SettingsRow
          label={msg.settings.page.llm}
          value={llmConfigured(settings.llm) ? settings.llm.model : msg.common.notSet}
          onOpen={() => setPage("llm")}
        />
      </SettingsGroup>
    </main>
  );
}

function SettingsGroup(props: { title: string; children: ReactNode }) {
  return (
    <section className="settings-group">
      <h2>{props.title}</h2>
      <ul>{props.children}</ul>
    </section>
  );
}

function SettingsRow(props: { label: string; value: ReactNode; onOpen: () => void }) {
  return (
    <li>
      <button type="button" className="settings-row" onClick={props.onOpen}>
        <span className="settings-row-label">{props.label}</span>
        <span className="settings-row-value">{props.value}</span>
        <span className="settings-row-chevron">›</span>
      </button>
    </li>
  );
}

/** "中国 · Azure · 晓晓 多语言 · 1.0×": the call language, the platform, its voice and the rate. */
function voiceSummary(settings: AppSettings): string {
  const locale = t().locale;
  const language = resolveSpeechLanguage(settings.speechLanguage);
  const engine = ttsEngine(settings.tts.engine);
  const config = configOf(settings.tts, engine.id);
  const voice = voiceFor(engine, config, language);
  const name = engine.voices(language).find((v) => v.id === voice);
  return [
    speechLanguageName(language, locale),
    engine.category === "custom" ? t().settings.voice.tab.custom : engine.name,
    name ? localized(name.name, locale) : voice,
    `${settings.rate.toFixed(1)}×`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** "经典 · 回铃音": the incoming call's tone, then the one while calling an agent. */
function ringtoneSummary(settings: AppSettings): string {
  const { ringtones, customRingtones } = settings;
  return [ringtones.incoming, ringtones.dispatch]
    .map((id) => ringtoneLabel(id, customRingtones, t()))
    .join(" · ");
}

/** "中文" / "English" / "跟随系统（中文）". */
function languageSummary(pref: LanguagePref): string {
  return pref === "system"
    ? t().settings.language.systemIs(LANGUAGE_NAME[systemLocale()])
    : LANGUAGE_NAME[pref];
}

/** "youtube-dubbing" once a token is saved, "未设置" before. */
function MulticaSummary(props: { daemon: DaemonLink }) {
  const msg = useT();
  const [state, setState] = useState<{ name: string | null } | "loading" | "failed">("loading");
  useEffect(() => {
    const ctrl = new AbortController();
    fetchMulticaSettings(props.daemon, ctrl.signal).then(
      ({ settings }) => !ctrl.signal.aborted && setState({ name: settings?.workspaceName ?? null }),
      () => !ctrl.signal.aborted && setState("failed"),
    );
    return () => ctrl.abort();
  }, [props.daemon]);
  if (state === "loading") return <>…</>;
  if (state === "failed") return <>{msg.settings.readFailed}</>;
  return <>{state.name ?? msg.common.notSet}</>;
}

/** "localhost:8787" once in an account, "未设置" before. */
function serverSummary(settings: AppSettings): string {
  const server = serverOf(settings);
  return server ? new URL(server.serverUrl).host : t().common.notSet;
}

/**
 * Which computer the Multica / LLM pages change: this machine's daemon, or (on a phone) one of the
 * account's computers through the server, picked here when there are several.
 */
function DaemonPicker(props: {
  daemon: DaemonLink | null;
  daemons: Device[];
  onPick: (daemonId: string) => void;
}) {
  const msg = useT();
  const { daemon, daemons } = props;
  if (!daemon) {
    return (
      <section className="settings-panel">
        <p className="muted">{msg.daemon.none}</p>
      </section>
    );
  }
  if (daemon.kind === "local" || daemons.length < 2) {
    return (
      <p className="muted daemon-target">
        {msg.daemon.target}：{daemonLabel(daemon)}
      </p>
    );
  }
  return (
    <label className="daemon-target">
      {msg.daemon.target}
      <select value={daemon.machine.id} onChange={(e) => props.onPick(e.target.value)}>
        {daemons.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
            {d.online ? "" : msg.daemon.offlineTag}
          </option>
        ))}
      </select>
    </label>
  );
}

function AddressPage(props: {
  value: string;
  onSave: (patch: SettingsPatch) => void;
  onCancel: () => void;
}) {
  const msg = useT();
  const [name, setName] = useState(props.value);

  function submit(e: FormEvent) {
    e.preventDefault();
    props.onSave({ addressName: normalizeAddressName(name) });
  }

  return (
    <form className="settings-panel" onSubmit={submit}>
      <label>
        {msg.settings.address.label}
        <input
          value={name}
          maxLength={ADDRESS_NAME_MAX}
          placeholder={DEFAULT_ADDRESS_NAME}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="muted">{msg.settings.address.hint(DEFAULT_ADDRESS_NAME)}</span>
      </label>
      <PageActions onCancel={props.onCancel} />
    </form>
  );
}

function NeedsServer() {
  const msg = useT();
  return (
    <section className="settings-panel">
      <p className="muted">{msg.settings.needsServer}</p>
    </section>
  );
}

/** 设置 → 语言: a fixed language, or the system's. */
function LanguagePage(props: {
  value: LanguagePref;
  onSave: (patch: SettingsPatch) => void;
  onCancel: () => void;
}) {
  const msg = useT();
  const [language, setLanguage] = useState(props.value);

  function submit(e: FormEvent) {
    e.preventDefault();
    props.onSave({ language });
  }

  return (
    <form className="settings-panel" onSubmit={submit}>
      <label>
        {msg.settings.language.label}
        <select value={language} onChange={(e) => setLanguage(e.target.value as LanguagePref)}>
          {LANGUAGE_PREFS.map((pref) => (
            <option key={pref} value={pref}>
              {pref === "system"
                ? msg.settings.language.systemIs(LANGUAGE_NAME[systemLocale()])
                : LANGUAGE_NAME[pref]}
            </option>
          ))}
        </select>
        <span className="muted">{msg.settings.language.hint}</span>
      </label>
      <PageActions onCancel={props.onCancel} />
    </form>
  );
}

function PageActions(props: { onCancel: () => void }) {
  const msg = useT();
  return (
    <div className="form-actions">
      <button type="button" className="secondary" onClick={props.onCancel}>
        {msg.common.cancel}
      </button>
      <button type="submit">{msg.common.save}</button>
    </div>
  );
}
