import { Check, Eye, EyeOff, KeyRound, RefreshCw, TriangleAlert, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { type DaemonLink, daemonLabel, removeDaemonLlm, saveDaemonLlm } from "../daemonLink.ts";
import { errorMessage } from "../format.ts";
import { t, useT } from "../i18n/index.ts";
import { type EndpointTest, listModels, testEndpoint } from "../llm/endpoint.ts";
import { CUSTOM_PROVIDER, LLM_PROVIDERS, normalizeBaseUrl, providerOf } from "../llm/providers.ts";
import { EMPTY_LLM, type LlmSettings, llmConfigured, type StructuredOutput } from "../llm/qa.ts";
import { ServerError } from "../serverClient.ts";
import { ComboPicker, PresetPicker } from "./Pickers.tsx";

/** "sk-…abcd": enough to recognise a saved key without showing it (the daemon shows the same). */
export function keyHint(key: string): string {
  return key.length > 8 ? `${key.slice(0, 3)}…${key.slice(-4)}` : t().common.saved;
}

/**
 * 设置 → 大模型: one OpenAI-compatible endpoint for both in-call questions (called from this
 * device) and the briefs the outbrief-daemon generates (the one on this machine, or on a phone the
 * computer picked in 设置 → 设备, through the server). The user picks a provider
 * (or types another OpenAI-compatible address), pastes a key and picks a model (the provider's built-in list, the
 * endpoint's own list, or any id typed in). The user also picks how briefs get their JSON
 * (`StructuredOutput`): 测试连接 makes the same kind of call the daemon makes with that strategy,
 * and offers the other one when json_schema is not supported. Saving keeps it on this device and, when the daemon
 * is reachable, makes it the daemon's brief LLM. Keys never go through the server in the clear.
 * Another computer's daemon (reached through the server) keeps its own model unless the user ticks
 * 同时用于…: a phone saving its own endpoint must not replace the one that computer works with
 * (OUTB-57: a phone's OpenRouter replaced the Mac's 127.0.0.1 endpoint).
 */
export function LlmSettingsSection(props: {
  value: LlmSettings;
  /** The daemon briefs are generated on; null when this account has none. */
  daemon: DaemonLink | null;
  onSave: (llm: LlmSettings) => void;
  onCancel: () => void;
}) {
  const msg = useT();
  const m = msg.settings.llm;
  const { daemon } = props;
  const saved = props.value;
  const [provider, setProvider] = useState(() =>
    saved.baseUrl ? providerOf(saved.baseUrl) : (LLM_PROVIDERS[0]?.id ?? CUSTOM_PROVIDER),
  );
  // The preset 内置服务商 returns to after a look at 自定义.
  const [lastPreset, setLastPreset] = useState(() =>
    provider === CUSTOM_PROVIDER ? (LLM_PROVIDERS[0]?.id ?? CUSTOM_PROVIDER) : provider,
  );
  const [customUrl, setCustomUrl] = useState(() =>
    providerOf(saved.baseUrl) === CUSTOM_PROVIDER ? saved.baseUrl : "",
  );
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  // A saved key shows as "已保存 sk-…abcd" until the user chooses to replace it.
  const [changingKey, setChangingKey] = useState(false);
  const [model, setModel] = useState(
    () => saved.model || (LLM_PROVIDERS.find((p) => p.id === provider)?.models[0] ?? ""),
  );
  const [structuredOutput, setStructuredOutput] = useState<StructuredOutput>(() =>
    saved.baseUrl
      ? saved.structuredOutput
      : (LLM_PROVIDERS.find((p) => p.id === provider)?.structuredOutput ?? "json_schema"),
  );
  const [models, setModels] = useState<string[] | null>(null);
  const [modelsBusy, setModelsBusy] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [test, setTest] = useState<EndpointTest | "running" | null>(null);
  const [busy, setBusy] = useState<"save" | "clear" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // This machine's daemon always follows; another computer's only when asked.
  const [alsoRemote, setAlsoRemote] = useState(false);
  const syncDaemon = daemon && (daemon.kind === "local" || alsoRemote) ? daemon : null;
  const modelsRequest = useRef(0);

  const preset = LLM_PROVIDERS.find((p) => p.id === provider);
  const baseUrl = preset ? preset.baseUrl : normalizeBaseUrl(customUrl);
  const urlValid = /^https?:\/\/[^/]/.test(baseUrl) && URL.canParse(baseUrl);
  // A saved key is reused only for the endpoint it was saved for.
  const sameEndpoint = !!saved.apiKey && baseUrl === saved.baseUrl;
  const effectiveKey = apiKey.trim() || (sameEndpoint ? saved.apiKey : "");
  const draft: LlmSettings = {
    baseUrl,
    apiKey: effectiveKey,
    model: model.trim(),
    structuredOutput,
  };
  const complete = urlValid && llmConfigured(draft);

  const loadModels = useCallback((url: string, key: string) => {
    const id = ++modelsRequest.current;
    setModelsBusy(true);
    setModelsError(null);
    listModels(url, key).then(
      (list) => {
        if (id !== modelsRequest.current) return;
        setModelsBusy(false);
        setModels(list);
        if (list.length === 0) setModelsError(t().settings.llm.noModels);
      },
      (err: unknown) => {
        if (id !== modelsRequest.current) return;
        setModelsBusy(false);
        setModels(null);
        setModelsError(errorMessage(err));
      },
    );
  }, []);

  // A saved endpoint lists its models straight away, so switching model is one pick; not while
  // another provider is being set up on the page.
  const baseUrlNow = useRef(baseUrl);
  baseUrlNow.current = baseUrl;
  useEffect(() => {
    if (llmConfigured(saved) && baseUrlNow.current === saved.baseUrl) {
      loadModels(saved.baseUrl, saved.apiKey);
    }
  }, [saved, loadModels]);

  /** Anything about the endpoint changed: earlier results no longer apply. */
  function edited() {
    setTest(null);
    setError(null);
    setNotice(null);
  }

  function endpointChanged() {
    modelsRequest.current++;
    setModels(null);
    setModelsBusy(false);
    setModelsError(null);
    edited();
  }

  function pickProvider(id: string) {
    if (id === provider) return;
    const next = LLM_PROVIDERS.find((p) => p.id === id);
    // Back on the saved provider: its saved model and strategy come back too.
    const back = llmConfigured(saved) && providerOf(saved.baseUrl) === id;
    setProvider(id);
    if (next) setLastPreset(id);
    setModel(back ? saved.model : (next?.models[0] ?? ""));
    setStructuredOutput(back ? saved.structuredOutput : (next?.structuredOutput ?? "json_schema"));
    endpointChanged();
    const key = apiKey.trim();
    if (next && key) loadModels(next.baseUrl, key);
  }

  function refreshModels() {
    if (urlValid && effectiveKey) loadModels(baseUrl, effectiveKey);
  }

  function runTest(strategy: StructuredOutput = structuredOutput) {
    if (!complete) return;
    setTest("running");
    setError(null);
    setNotice(null);
    void testEndpoint({ ...draft, structuredOutput: strategy }).then(setTest);
  }

  function pickStrategy(next: StructuredOutput) {
    setStructuredOutput(next);
    edited();
  }

  /** 测试连接 found json_schema unsupported: switch to JSON mode and test again right away. */
  function retryWithJsonMode() {
    setStructuredOutput("json_object");
    runTest("json_object");
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!urlValid) return setError(m.urlInvalid);
    if (!effectiveKey) return setError(m.keyRequired);
    if (!draft.model) return setError(m.modelRequired);
    setBusy("save");
    setError(null);
    setNotice(null);
    props.onSave(draft);
    setApiKey("");
    setChangingKey(false);
    setCustomUrl(provider === CUSTOM_PROVIDER ? baseUrl : "");
    if (!syncDaemon) {
      setBusy(null);
      setNotice(daemon ? m.savedNotDaemon(daemonLabel(daemon)) : m.savedHere);
      return;
    }
    try {
      await saveDaemonLlm(syncDaemon, draft);
      setNotice(m.savedBoth);
    } catch (err) {
      if (err instanceof ServerError && err.status === null) {
        setNotice(m.savedDaemonDown);
      } else {
        setError(m.daemonSaveFailed(errorMessage(err)));
      }
    } finally {
      setBusy(null);
    }
  }

  async function clear() {
    setBusy("clear");
    setError(null);
    setNotice(null);
    props.onSave(EMPTY_LLM);
    setApiKey("");
    setModel("");
    setCustomUrl("");
    endpointChanged();
    try {
      if (syncDaemon) await removeDaemonLlm(syncDaemon);
      setNotice(syncDaemon || !daemon ? m.cleared : m.clearedHere(daemonLabel(daemon)));
    } catch (err) {
      // The daemon not running is fine: it has nothing to clear until it runs with this setting.
      if (err instanceof ServerError && err.status === null) setNotice(m.cleared);
      else setError(m.daemonSaveFailed(errorMessage(err)));
    } finally {
      setBusy(null);
    }
  }

  const showSavedKey = sameEndpoint && !changingKey && !apiKey;
  const keyNote = provider === "ollama" ? m.keyNoteOllama : preset ? m.keyNote : m.keyNoteCustom;

  return (
    <form className="settings-panel llm-settings" onSubmit={submit}>
      <div className="segmented" role="tablist">
        {(["builtin", "custom"] as const).map((tab) => {
          const on = (tab === "custom") === (provider === CUSTOM_PROVIDER);
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={on}
              className={on ? "selected" : undefined}
              onClick={() => pickProvider(tab === "custom" ? CUSTOM_PROVIDER : lastPreset)}
            >
              {m.tab[tab]}
            </button>
          );
        })}
      </div>

      {preset && (
        <div className="field">
          <span className="field-label">{m.provider}</span>
          <PresetPicker
            items={PROVIDER_ITEMS}
            value={preset.id}
            onChange={pickProvider}
            searchPlaceholder={m.searchProvider}
            noMatch={m.noProviderMatch}
          />
        </div>
      )}

      {!preset && (
        <label>
          {m.baseUrl}
          <input
            value={customUrl}
            placeholder="https://api.example.com/v1"
            spellCheck={false}
            autoCapitalize="off"
            onChange={(e) => {
              setCustomUrl(e.target.value);
              endpointChanged();
            }}
            onBlur={() => {
              const normalized = normalizeBaseUrl(customUrl);
              if (normalized !== customUrl) setCustomUrl(normalized);
              if (URL.canParse(normalized) && effectiveKey && !models) {
                loadModels(normalized, effectiveKey);
              }
            }}
          />
          <span className="muted">{m.customHint}</span>
        </label>
      )}

      <div className="field">
        <span className="field-label">{m.apiKey}</span>
        {showSavedKey ? (
          <span className="key-saved">
            <KeyRound size={16} />
            <span>{m.keySaved}</span>
            <span className="mono">{keyHint(saved.apiKey)}</span>
            <button type="button" className="pill small-pill" onClick={() => setChangingKey(true)}>
              {m.changeKey}
            </button>
          </span>
        ) : (
          <span className="input-with-button">
            <input
              type={showKey ? "text" : "password"}
              value={apiKey}
              placeholder="sk-…"
              aria-label={m.apiKey}
              autoComplete="off"
              spellCheck={false}
              // biome-ignore lint/a11y/noAutofocus: opened by the user's own 更换 click
              autoFocus={changingKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                endpointChanged();
              }}
              onBlur={() => {
                if (apiKey.trim() && urlValid && !models) loadModels(baseUrl, apiKey.trim());
              }}
            />
            <button
              type="button"
              className="icon-inside"
              aria-label={showKey ? m.hideKey : m.showKey}
              title={showKey ? m.hideKey : m.showKey}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </span>
        )}
        {sameEndpoint && changingKey && (
          <button
            type="button"
            className="link inline-link"
            onClick={() => {
              setApiKey("");
              setChangingKey(false);
              endpointChanged();
            }}
          >
            {m.keepSavedKey(keyHint(saved.apiKey))}
          </button>
        )}
        <span className="muted">{keyNote}</span>
      </div>

      <div className="field">
        <span className="field-label">{m.model}</span>
        <div className="model-row">
          <ComboPicker
            value={model}
            groups={[
              { label: m.builtInModels, options: (preset?.models ?? []).map((id) => ({ id })) },
              { label: m.fetchedModels, options: (models ?? []).map((id) => ({ id })) },
            ]}
            onChange={(value) => {
              setModel(value);
              edited();
            }}
            placeholder={m.modelPlaceholder}
            chooseLabel={m.chooseModel}
            noMatch={m.noMatch}
          />
          <button
            type="button"
            className="pill icon-pill"
            disabled={!urlValid || !effectiveKey || modelsBusy}
            onClick={refreshModels}
            title={m.fetchModels}
          >
            <RefreshCw size={15} className={modelsBusy ? "spin" : undefined} />
            {m.fetchModels}
          </button>
        </div>
        {modelsError ? (
          <span className="warn field-hint">{m.modelsFailed(modelsError)}</span>
        ) : (
          <span className="muted field-hint">
            {modelsBusy ? m.loadingModels : models ? m.modelCount(models.length) : m.modelHint}
          </span>
        )}
      </div>

      <div className="field">
        <span className="field-label">{m.strategy}</span>
        <div className="segmented">
          {(["json_schema", "json_object"] as const).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={s === structuredOutput}
              className={s === structuredOutput ? "selected" : undefined}
              onClick={() => pickStrategy(s)}
            >
              {m.strategyName[s]}
            </button>
          ))}
        </div>
        <span className="muted field-hint">{m.strategyHint[structuredOutput]}</span>
      </div>

      <div className="test-row">
        <button
          type="button"
          className="pill"
          disabled={!complete || test === "running"}
          onClick={() => runTest()}
        >
          {test === "running" ? m.testing : m.test}
        </button>
        {test && test !== "running" && (
          <TestResult
            result={test}
            strategy={structuredOutput}
            onRetryJsonMode={retryWithJsonMode}
          />
        )}
      </div>

      {daemon?.kind === "relay" && (
        <div className="field">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={alsoRemote}
              onChange={(e) => {
                setAlsoRemote(e.target.checked);
                setNotice(null);
              }}
            />
            {m.alsoDaemon(daemon.machine.name)}
          </label>
          <span className="muted field-hint">{m.alsoDaemonHint}</span>
        </div>
      )}

      {error && <p className="warn">{error}</p>}
      {notice && <p className="notice">{notice}</p>}

      <div className="form-actions">
        {llmConfigured(saved) && (
          <button
            type="button"
            className="secondary danger push-left"
            disabled={busy !== null}
            onClick={() => void clear()}
          >
            {busy === "clear" ? m.clearing : m.clear}
          </button>
        )}
        <button type="button" className="secondary" onClick={props.onCancel}>
          {msg.common.cancel}
        </button>
        <button type="submit" disabled={busy !== null}>
          {busy === "save" ? m.saving : msg.common.save}
        </button>
      </div>
    </form>
  );
}

function hostOf(url: string): string {
  return URL.canParse(url) ? new URL(url).host : url;
}

const PROVIDER_ITEMS = LLM_PROVIDERS.map((p) => ({
  id: p.id,
  name: p.name,
  detail: hostOf(p.baseUrl),
}));

function seconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}

function TestResult(props: {
  result: EndpointTest;
  strategy: StructuredOutput;
  onRetryJsonMode: () => void;
}) {
  const m = useT().settings.llm;
  const { result } = props;
  if (result.kind === "ok") {
    return (
      <span className="test-result ok">
        <Check size={15} /> {m.testOk(seconds(result.ms))}
      </span>
    );
  }
  if (result.kind === "chatOnly") {
    return (
      <span className="test-result partial">
        <span className="test-line">
          <TriangleAlert size={15} />
          {props.strategy === "json_schema"
            ? m.testNoJsonSchema(seconds(result.ms))
            : m.testBadJson(seconds(result.ms))}
        </span>
        <span className="test-detail">{result.error}</span>
        {props.strategy === "json_schema" && (
          <button type="button" className="pill small-pill" onClick={props.onRetryJsonMode}>
            {m.retryJsonMode}
          </button>
        )}
      </span>
    );
  }
  return (
    <span className="test-result failed">
      <X size={15} /> {m.testFailed(result.error)}
    </span>
  );
}
