import { Check } from "lucide-react";
import { useState } from "react";
import { errorMessage } from "../format.ts";
import { useT } from "../i18n/index.ts";
import {
  parseCurl,
  putPlaceholder,
  type RequestSlot,
  requestSlots,
  withGuessedPlaceholders,
} from "../voice/tts/curl.ts";
import {
  type HttpTemplate,
  type ResponseSpec,
  type TemplateVariable,
  templateProblem,
} from "../voice/tts/template.ts";

/**
 * 设置 → 语音 → 自定义接口: the request is only ever pasted as a curl example from the platform's
 * docs — there is no hand-written method / URL / header / body form, because filling one in on a
 * phone is not worth it (YOUT-191 review).
 *
 * Importing turns the example's own field names into placeholders (`{{text}}`, `{{voice}}`,
 * `{{speed}}`) automatically, and each of those three is then a row of tappable chips showing the
 * example's real values, so re-picking one is a tap rather than typing braces. The pasted request
 * is shown read-only underneath, so what will be sent is never hidden.
 */
export function RequestEditor(props: {
  value: HttpTemplate;
  onChange: (next: HttpTemplate) => void;
}) {
  const msg = useT();
  const m = msg.settings.voice.request;
  const t = props.value;
  const [curl, setCurl] = useState("");
  const [imported, setImported] = useState(false);
  const [importFailed, setImportFailed] = useState<string | null>(null);
  const problem = templateProblem(t);
  const imported_ = imported || !!t.url;

  function runImport() {
    setImportFailed(null);
    try {
      const parsed = withGuessedPlaceholders(parseCurl(curl));
      props.onChange({ ...parsed, response: t.response });
      setCurl("");
      setImported(true);
    } catch (err) {
      setImported(false);
      setImportFailed(m.importFailed(errorMessage(err)));
    }
  }

  return (
    <section className="request-editor">
      <h3>{m.title}</h3>
      <p className="muted field-hint">{m.intro}</p>

      <div className="field">
        <span className="field-label">{m.importCurl}</span>
        <textarea
          className="curl-input"
          rows={5}
          value={curl}
          placeholder={m.curlPlaceholder}
          spellCheck={false}
          autoCapitalize="off"
          onChange={(e) => setCurl(e.target.value)}
        />
        <div className="inline-row">
          <button type="button" className="pill" disabled={!curl.trim()} onClick={runImport}>
            {m.import}
          </button>
          {importFailed ? (
            <span className="warn field-hint">{importFailed}</span>
          ) : (
            <span className="muted field-hint">{m.importHint}</span>
          )}
        </div>
      </div>

      {imported_ && (
        <>
          <SlotChips value={t} onChange={props.onChange} />
          <RequestPreview value={t} />
          {problem === "text" && <span className="warn field-hint">{m.problem.text}</span>}
          {problem === "url" && <span className="warn field-hint">{m.problem.url}</span>}
          <ResponseFields
            value={t.response}
            onChange={(response) => props.onChange({ ...t, response })}
            pathProblem={problem === "path"}
          />
        </>
      )}
    </section>
  );
}

/** The three placeholders a pasted request needs mapped; the rest fill themselves in. */
const SLOTS = [
  { variable: "text", token: "{{text}}" },
  { variable: "voice", token: "{{voice}}" },
  { variable: "speed", token: "{{speed}}" },
] as const satisfies readonly { variable: TemplateVariable; token: string }[];

/**
 * Which value of the pasted request stands for the sentence, the voice and the speed: one row of
 * chips each, showing the example's own values, the chosen one ticked. Import guesses these from the
 * field names, so this is normally just a confirmation.
 */
function SlotChips(props: { value: HttpTemplate; onChange: (next: HttpTemplate) => void }) {
  const m = useT().settings.voice.request;
  const slots = requestSlots(props.value);

  return (
    <>
      {SLOTS.map(({ variable, token }) => {
        const taken = slots.find((s) => s.sample.includes(token));
        const options = slots.filter((s) => s === taken || !/\{\{\w+\}\}/.test(s.sample));
        if (options.length === 0) return null;
        return (
          <div className="field" key={variable}>
            <span className="field-label">{m.slotFor[variable]}</span>
            <div className="chip-row">
              {options.map((slot) => (
                <SlotChip
                  key={`${slot.kind}:${slot.path}`}
                  slot={slot}
                  chosen={slot === taken}
                  onPick={() => props.onChange(putPlaceholder(props.value, slot, token))}
                />
              ))}
            </div>
            <span className="muted field-hint">
              {taken ? m.slotChosen(taken.path) : m.slotHint[variable]}
            </span>
          </div>
        );
      })}
    </>
  );
}

function SlotChip(props: { slot: RequestSlot; chosen: boolean; onPick: () => void }) {
  const { slot } = props;
  return (
    <button
      type="button"
      className={props.chosen ? "pill small-pill selected" : "pill small-pill"}
      aria-pressed={props.chosen}
      onClick={props.onPick}
    >
      {props.chosen && <Check size={13} />}
      {slot.path}
      <code>{slot.sample.length > 18 ? `${slot.sample.slice(0, 18)}…` : slot.sample}</code>
    </button>
  );
}

/** The request as it will be sent, read-only: re-import to change it. */
function RequestPreview(props: { value: HttpTemplate }) {
  const m = useT().settings.voice.request;
  const t = props.value;
  const lines = [
    `${t.method} ${t.url}`,
    ...t.headers.filter((h) => h.name.trim()).map((h) => `${h.name}: ${h.value}`),
    ...(t.body.trim() ? ["", t.body] : []),
  ];

  return (
    <div className="field">
      <span className="field-label">{m.preview}</span>
      <pre className="request-preview">{lines.join("\n")}</pre>
    </div>
  );
}

/** Where the audio is in the response, and how to read its bytes. */
function ResponseFields(props: {
  value: ResponseSpec;
  onChange: (next: ResponseSpec) => void;
  pathProblem: boolean;
}) {
  const m = useT().settings.voice.request;
  const r = props.value;
  const set = (next: Partial<ResponseSpec>) => props.onChange({ ...r, ...next });

  return (
    <>
      <div className="field">
        <span className="field-label">{m.response}</span>
        <div className="segmented">
          {(["body", "json"] as const).map((source) => (
            <button
              key={source}
              type="button"
              aria-pressed={source === r.source}
              className={source === r.source ? "selected" : undefined}
              onClick={() => set({ source })}
            >
              {m.source[source]}
            </button>
          ))}
        </div>
      </div>

      {r.source === "json" && (
        <>
          <div className="field">
            <span className="field-label">{m.path}</span>
            <input
              value={r.path}
              placeholder={m.pathPlaceholder}
              aria-label={m.path}
              spellCheck={false}
              autoCapitalize="off"
              onChange={(e) => set({ path: e.target.value })}
            />
            {props.pathProblem ? (
              <span className="warn field-hint">{m.problem.path}</span>
            ) : (
              <span className="muted field-hint">{m.pathHint}</span>
            )}
          </div>
          <div className="field">
            <span className="field-label">{m.encoding}</span>
            <div className="segmented">
              {(["base64", "hex", "url"] as const).map((encoding) => (
                <button
                  key={encoding}
                  type="button"
                  aria-pressed={encoding === r.encoding}
                  className={encoding === r.encoding ? "selected" : undefined}
                  onClick={() => set({ encoding })}
                >
                  {m.encodingName[encoding]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <div className="field">
        <span className="field-label">{m.format}</span>
        <div className="segmented">
          {(["auto", "pcm16"] as const).map((format) => (
            <button
              key={format}
              type="button"
              aria-pressed={format === r.format}
              className={format === r.format ? "selected" : undefined}
              onClick={() => set({ format })}
            >
              {m.formatName[format]}
            </button>
          ))}
        </div>
        <span className="muted field-hint">{m.formatHint}</span>
      </div>

      {r.format === "pcm16" && (
        <div className="field">
          <span className="field-label">{m.sampleRate}</span>
          <input
            type="number"
            min={8000}
            max={48000}
            step={1000}
            value={r.sampleRate}
            aria-label={m.sampleRate}
            onChange={(e) => set({ sampleRate: Number(e.target.value) || r.sampleRate })}
          />
        </div>
      )}
    </>
  );
}
