import { Check, ExternalLink, Eye, EyeOff, KeyRound, RefreshCw, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isAbortError, SentencePlayer } from "../call/player.ts";
import { errorMessage } from "../format.ts";
import { defaultFetch } from "../http.ts";
import { type Messages, useT } from "../i18n/index.ts";
import { type AppSettings, RATE_MAX, RATE_MIN } from "../settings.ts";
import {
  createSpeechSynth,
  previewText,
  resolveSpeechLanguage,
  SPEECH_LANGUAGES,
  type SpeechLanguage,
  type SpeechLanguagePref,
  speechLanguageName,
  systemSpeechLanguage,
  VoiceUnavailableError,
} from "../voice/index.ts";
import { CUSTOM_ENGINE } from "../voice/tts/engines/custom.ts";
import { BUILTIN_ENGINES, DEFAULT_ENGINE, ttsEngine } from "../voice/tts/registry.ts";
import { configOf, missingSetting, voiceFor } from "../voice/tts/settings.ts";
import { EMPTY_TEMPLATE, type HttpTemplate } from "../voice/tts/template.ts";
import {
  localized,
  type TtsConfig,
  type TtsEngine,
  type TtsField,
  type TtsVoice,
} from "../voice/tts/types.ts";
import { keyHint } from "./LlmSettingsSection.tsx";
import { ComboPicker, PresetPicker } from "./Pickers.tsx";
import type { SettingsPatch } from "./SettingsForm.tsx";
import { RequestEditor } from "./TtsRequestEditor.tsx";

/** The call languages sorted by their names in the UI language, as the plugin's picker lists. */
function sortedSpeechLanguages(ui: Messages["locale"]): SpeechLanguage[] {
  return [...SPEECH_LANGUAGES].sort((a, b) =>
    speechLanguageName(a, ui).localeCompare(speechLanguageName(b, ui), ui),
  );
}

/**
 * 设置 → 语音: the report language, then the speech platform and everything it needs — its own
 * fields (key, region, address…), model, voice, the rate, and 试听 / 测试合成. Built-in platforms
 * come from `tts/registry.ts`, so a new one needs no change here; 自定义接口 describes any HTTP
 * API as a request template. Each platform keeps its own settings, so switching back loses nothing.
 */
export function VoiceSettingsSection(props: {
  settings: AppSettings;
  onSave: (patch: SettingsPatch) => void;
  onCancel: () => void;
}) {
  const msg = useT();
  const m = msg.settings.voice;
  const saved = props.settings.tts;
  const [engineId, setEngineId] = useState(saved.engine);
  // The built-in platform 内置平台 returns to after a look at 自定义接口.
  const [lastBuiltin, setLastBuiltin] = useState(() =>
    saved.engine === CUSTOM_ENGINE ? DEFAULT_ENGINE : saved.engine,
  );
  // Every platform's draft, so switching between them on this page keeps what was typed.
  const [drafts, setDrafts] = useState<Record<string, TtsConfig>>(() => ({ ...saved.configs }));
  const [speechLanguage, setSpeechLanguage] = useState(props.settings.speechLanguage);
  const [rate, setRate] = useState(props.settings.rate);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const languages = useMemo(() => sortedSpeechLanguages(msg.locale), [msg.locale]);
  const language = resolveSpeechLanguage(speechLanguage);

  const engine = ttsEngine(engineId);
  const config = drafts[engineId] ?? configOf(saved, engineId);
  const savedConfig = configOf(saved, engineId);
  const voice = voiceFor(engine, config, language);
  const patch = (next: Partial<TtsConfig>) => {
    setDrafts((prev) => ({ ...prev, [engineId]: { ...config, ...next } }));
    setError(null);
    setNotice(null);
  };

  function pickEngine(id: string) {
    if (id === engineId) return;
    setEngineId(id);
    if (id !== CUSTOM_ENGINE) setLastBuiltin(id);
    setError(null);
    setNotice(null);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const missing = missingSetting(engine, config);
    if (missing) {
      const field = engine.fields.find((f) => f.key === missing);
      setError(
        field ? m.missing(localized(field.label, msg.locale)) : (m.request.problem.text as string),
      );
      return;
    }
    props.onSave({
      speechLanguage,
      rate,
      tts: {
        engine: engineId,
        configs: { ...saved.configs, ...drafts, [engineId]: { ...config, voice } },
      },
    });
  }

  return (
    <form className="settings-panel llm-settings" onSubmit={submit}>
      <div className="field">
        <span className="field-label">{m.language}</span>
        <select
          value={speechLanguage}
          onChange={(e) => setSpeechLanguage(e.target.value as SpeechLanguagePref)}
        >
          <option value="system">
            {msg.settings.language.systemIs(speechLanguageName(systemSpeechLanguage(), msg.locale))}
          </option>
          {languages.map((l) => (
            <option key={l} value={l}>
              {speechLanguageName(l, msg.locale)}
            </option>
          ))}
        </select>
      </div>

      <div className="segmented" role="tablist">
        {(["builtin", "custom"] as const).map((tab) => {
          const on = (tab === "custom") === (engineId === CUSTOM_ENGINE);
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={on}
              className={on ? "selected" : undefined}
              onClick={() => pickEngine(tab === "custom" ? CUSTOM_ENGINE : lastBuiltin)}
            >
              {m.tab[tab]}
            </button>
          );
        })}
      </div>

      {engine.category !== "custom" && (
        <div className="field">
          <span className="field-label">{m.engine}</span>
          <EnginePicker value={engineId} onChange={pickEngine} />
          {engine.docs && (
            <a
              className="muted field-hint doc-link"
              href={engine.docs}
              target="_blank"
              rel="noreferrer"
            >
              {m.docs} <ExternalLink size={13} />
            </a>
          )}
        </div>
      )}

      {engine.fields.map((field) => (
        <EngineField
          key={field.key}
          field={field}
          value={config.values[field.key] ?? ""}
          saved={savedConfig.values[field.key] ?? ""}
          onChange={(value) => patch({ values: { ...config.values, [field.key]: value } })}
        />
      ))}

      {engine.category === "custom" && (
        <RequestEditor
          value={config.request ?? EMPTY_TEMPLATE}
          onChange={(request: HttpTemplate) => patch({ request })}
        />
      )}

      {engine.models.length > 0 && (
        <div className="field">
          <span className="field-label">{m.model}</span>
          <ComboPicker
            value={config.model}
            groups={[{ label: m.builtInModels, options: engine.models.map((id) => ({ id })) }]}
            onChange={(model) => patch({ model })}
            placeholder={m.modelPlaceholder}
            chooseLabel={m.chooseModel}
            noMatch={m.noModelMatch}
          />
        </div>
      )}

      <VoiceField
        engine={engine}
        config={config}
        language={language}
        voice={voice}
        onChange={(next) => patch({ voice: next })}
      />

      <div className="field">
        <span className="field-label label-row">
          {m.rate} <span className="value">{rate.toFixed(1)}×</span>
        </span>
        <input
          type="range"
          min={RATE_MIN}
          max={RATE_MAX}
          step={0.1}
          value={rate}
          aria-label={m.rate}
          onChange={(e) => setRate(Number(e.target.value))}
        />
        {!engine.rate && <span className="muted field-hint">{m.noRate}</span>}
      </div>

      <VoiceTest
        engine={engine}
        config={config}
        voice={voice}
        rate={rate}
        language={language}
        onError={setError}
      />

      {error && <p className="warn">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="form-actions">
        <button type="button" className="secondary" onClick={props.onCancel}>
          {msg.common.cancel}
        </button>
        <button type="submit">{msg.common.save}</button>
      </div>
    </form>
  );
}

/** The built-in platforms as one dropdown: name plus its host or "免费" / "自部署". */
function EnginePicker(props: { value: string; onChange: (id: string) => void }) {
  const m = useT().settings.voice;
  const locale = useT().locale;
  const items = useMemo(
    () =>
      BUILTIN_ENGINES.map((e) => ({
        id: e.id,
        name: e.name,
        detail: localized(e.site, locale),
      })),
    [locale],
  );
  return (
    <PresetPicker
      items={items}
      value={props.value}
      onChange={props.onChange}
      searchPlaceholder={m.searchEngine}
      noMatch={m.noEngineMatch}
    />
  );
}

/** One of the platform's own settings; a `secret` shows as "已保存 sk-…abcd" until replaced. */
function EngineField(props: {
  field: TtsField;
  value: string;
  saved: string;
  onChange: (value: string) => void;
}) {
  const msg = useT();
  const m = msg.settings.voice;
  const { field } = props;
  const [show, setShow] = useState(false);
  const [changing, setChanging] = useState(false);
  const label = localized(field.label, msg.locale);
  const hint = field.hint ? localized(field.hint, msg.locale) : null;
  const showSaved = field.kind === "secret" && !!props.saved && !changing && !props.value;

  return (
    <div className="field">
      <span className="field-label">{label}</span>
      {field.kind === "select" ? (
        <select
          value={props.value || field.default || ""}
          onChange={(e) => props.onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {localized(o.label, msg.locale)}
            </option>
          ))}
        </select>
      ) : showSaved ? (
        <span className="key-saved">
          <KeyRound size={16} />
          <span>{m.saved}</span>
          <span className="mono">{keyHint(props.saved)}</span>
          <button type="button" className="pill small-pill" onClick={() => setChanging(true)}>
            {m.change}
          </button>
        </span>
      ) : field.kind === "secret" ? (
        <span className="input-with-button">
          <input
            type={show ? "text" : "password"}
            value={props.value}
            placeholder={field.placeholder}
            aria-label={label}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => props.onChange(e.target.value)}
          />
          <button
            type="button"
            className="icon-inside"
            aria-label={show ? m.hideSecret : m.showSecret}
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </span>
      ) : (
        <input
          value={props.value}
          placeholder={field.placeholder ?? field.default}
          aria-label={label}
          spellCheck={false}
          autoCapitalize="off"
          inputMode={field.kind === "url" ? "url" : undefined}
          onChange={(e) => props.onChange(e.target.value)}
        />
      )}
      {showSaved && changing && (
        <button
          type="button"
          className="link inline-link"
          onClick={() => {
            props.onChange("");
            setChanging(false);
          }}
        >
          {m.keepSaved(keyHint(props.saved))}
        </button>
      )}
      {hint && <span className="muted field-hint">{hint}</span>}
    </div>
  );
}

/**
 * The voice: the platform's own voices for the call language, grouped female / male, plus the
 * account's voices once fetched (cloned or designed ones). Platforms that take any id let one be
 * typed in.
 */
function VoiceField(props: {
  engine: TtsEngine;
  config: TtsConfig;
  language: SpeechLanguage;
  voice: string;
  onChange: (voice: string) => void;
}) {
  const msg = useT();
  const m = msg.settings.voice;
  const { engine, config, language } = props;
  const [fetched, setFetched] = useState<TtsVoice[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const request = useRef(0);
  // Another platform's voices must not show under this one.
  const shownFor = useRef(engine.id);
  if (shownFor.current !== engine.id) {
    shownFor.current = engine.id;
    request.current++;
    setFetched(null);
    setFailed(null);
    setBusy(false);
  }

  const own = useMemo(() => engine.voices(language), [engine, language]);
  const named = (list: readonly TtsVoice[]) =>
    list.map((v) => ({ id: v.id, label: localized(v.name, msg.locale) }));
  const groups = [
    { label: m.gender.female, options: named(own.filter((v) => v.gender === "female")) },
    { label: m.gender.male, options: named(own.filter((v) => v.gender === "male")) },
    { label: "", options: named(own.filter((v) => !v.gender)) },
    { label: m.accountVoices, options: named(fetched ?? []) },
  ];

  function fetchVoices() {
    if (!engine.listVoices || missingSetting(engine, config)) return;
    const id = ++request.current;
    setBusy(true);
    setFailed(null);
    engine.listVoices(config, { fetch: defaultFetch() }).then(
      (list) => {
        if (id !== request.current) return;
        setBusy(false);
        setFetched(list);
      },
      (err: unknown) => {
        if (id !== request.current) return;
        setBusy(false);
        setFailed(errorMessage(err));
      },
    );
  }

  return (
    <div className="field">
      <span className="field-label">{m.voice}</span>
      <div className="model-row">
        {engine.customVoice ? (
          <ComboPicker
            value={props.voice}
            groups={groups}
            onChange={props.onChange}
            placeholder={m.voicePlaceholder}
            chooseLabel={m.chooseVoice}
            noMatch={m.noVoiceMatch}
            showNames
          />
        ) : (
          <select
            value={props.voice}
            aria-label={m.voice}
            onChange={(e) => props.onChange(e.target.value)}
          >
            {groups
              .filter((g) => g.options.length > 0)
              .map((g) => (
                <optgroup key={g.label} label={g.label}>
                  {g.options.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </optgroup>
              ))}
          </select>
        )}
        {engine.listVoices && (
          <button
            type="button"
            className="pill icon-pill"
            disabled={busy || !!missingSetting(engine, config)}
            onClick={fetchVoices}
          >
            <RefreshCw size={15} className={busy ? "spin" : undefined} />
            {m.fetchVoices}
          </button>
        )}
      </div>
      {failed ? (
        <span className="warn field-hint">{m.voicesFailed(failed)}</span>
      ) : busy ? (
        <span className="muted field-hint">{m.fetchingVoices}</span>
      ) : fetched ? (
        <span className="muted field-hint">{m.voiceCount(fetched.length)}</span>
      ) : engine.category === "free" ? (
        <span className="muted field-hint">{m.voiceFree}</span>
      ) : null}
    </div>
  );
}

/** Speaks the preview sentence with the settings on the page, without saving them first. */
function VoiceTest(props: {
  engine: TtsEngine;
  config: TtsConfig;
  voice: string;
  rate: number;
  language: SpeechLanguage;
  onError: (message: string | null) => void;
}) {
  const msg = useT();
  const m = msg.settings.voice;
  const player = useMemo(() => new SentencePlayer(createSpeechSynth()), []);
  const playback = useRef<AbortController | null>(null);
  const [playing, setPlaying] = useState(false);
  const [took, setTook] = useState<number | null>(null);
  const stop = useCallback(() => {
    playback.current?.abort();
    player.stop();
  }, [player]);
  useEffect(() => stop, [stop]);
  // Why the button is disabled, in the words of whatever is actually missing: the platform's own
  // setting (its label), a voice, or — only for 自定义接口 — a request that has no sentence yet.
  const missing = missingSetting(props.engine, props.config);
  const missingField = props.engine.fields.find((f) => f.key === missing);
  const blocker = missingField
    ? m.cannotTest(localized(missingField.label, msg.locale))
    : missing === "request"
      ? props.config.request
        ? m.request.problem.text
        : m.needRequest
      : !props.voice
        ? m.needVoice
        : null;

  function toggle() {
    stop();
    props.onError(null);
    setTook(null);
    if (playing) {
      setPlaying(false);
      return;
    }
    const ctrl = new AbortController();
    playback.current = ctrl;
    setPlaying(true);
    const started = performance.now();
    const opts = {
      engine: props.engine.id,
      config: props.config,
      voice: props.voice,
      rate: props.rate,
      language: props.language,
    };
    player.play(previewText(props.language), [], opts, ctrl.signal).then(
      () => {
        setPlaying(false);
        setTook(performance.now() - started);
      },
      (err: unknown) => {
        if (isAbortError(err)) return;
        setPlaying(false);
        // Every engine failure arrives as VoiceUnavailableError; its cause says what went wrong.
        const why =
          err instanceof VoiceUnavailableError && err.cause
            ? errorMessage(err.cause)
            : errorMessage(err);
        props.onError(m.testFailed(why));
      },
    );
  }

  return (
    <div className="test-row">
      <button type="button" className="pill" disabled={blocker !== null} onClick={toggle}>
        {playing ? m.testing : m.test}
      </button>
      {took !== null && (
        <span className="test-result ok">
          <Check size={15} /> {m.testOk((took / 1000).toFixed(1))}
        </span>
      )}
      {blocker !== null && !playing && (
        <span className="muted field-hint">
          <X size={13} /> {blocker}
        </span>
      )}
    </div>
  );
}
