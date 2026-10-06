import { audioBody, jsonBody, postJson } from "../audio.ts";
import { fieldValues, type TtsEngine, type TtsVoice } from "../types.ts";

/**
 * ElevenLabs `POST /v1/text-to-speech/{voice_id}` (elevenlabs.io/docs/api-reference/
 * text-to-speech/convert, checked 2026-09-29): the body is the audio, `output_format` goes in the
 * query string, and the key is the `xi-api-key` header.
 *
 * A voice is NOT tied to a language here: the multilingual models read every language they support
 * with any voice, and Eleven v4 even drops the reference accent when the target language differs
 * ("this makes every voice usable across every supported language"). So `voices` does not vary by
 * call language — unlike MiniMax / 豆包 / Azure, whose voices are per language.
 *
 * What it does mean is that the built-in list cannot be complete: voice ids are per account, the
 * Default voices expire 2026-12-31 and are gone for accounts created after March 2026, and the docs
 * publish an id for only these two. 获取音色 (`GET /v2/voices`) is the real list.
 * Eleven v4 ignores `speed`, and the request stays valid with it.
 */
const SERVERS: Record<string, string> = {
  global: "https://api.elevenlabs.io",
  us: "https://api.us.elevenlabs.io",
  eu: "https://api.eu.residency.elevenlabs.io",
  in: "https://api.in.residency.elevenlabs.io",
  sg: "https://api.sg.residency.elevenlabs.io",
};

/** The only voices the docs give an id for; everything else comes from 获取音色. */
const VOICES: TtsVoice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
];

function baseUrl(values: Record<string, string>): string {
  return SERVERS[values.server ?? "global"] ?? "https://api.elevenlabs.io";
}

export const elevenlabs: TtsEngine = {
  id: "elevenlabs",
  name: "ElevenLabs",
  category: "cloud",
  site: "api.elevenlabs.io",
  docs: "https://elevenlabs.io/docs/api-reference/text-to-speech/convert",
  fields: [
    { key: "apiKey", label: "API Key", kind: "secret", placeholder: "sk_…" },
    {
      key: "server",
      label: { zh: "服务器", en: "Server" },
      kind: "select",
      default: "global",
      options: [
        { value: "global", label: { zh: "全球", en: "Global" } },
        { value: "us", label: { zh: "美国", en: "US" } },
        { value: "eu", label: { zh: "欧盟", en: "EU" } },
        { value: "in", label: { zh: "印度", en: "India" } },
        { value: "sg", label: { zh: "新加坡", en: "Singapore" } },
      ],
    },
  ],
  models: ["eleven_v4", "eleven_v3", "eleven_multilingual_v2", "eleven_flash_v2_5"],
  voices: () => VOICES,
  customVoice: true,
  defaultVoice: () => "JBFqnCBsd6RMkjVDRZzb",
  // voice_settings.speed: 0.7–1.2, default 1.0 (best-practices).
  rate: { min: 0.7, max: 1.2 },
  async listVoices(config, ctx) {
    const values = fieldValues(elevenlabs, config);
    const json = await jsonBody<{
      voices?: { voice_id?: string; name?: string; labels?: { gender?: string } }[];
    }>(
      await ctx.fetch(`${baseUrl(values)}/v2/voices?page_size=100`, {
        headers: { "xi-api-key": values.apiKey ?? "" },
        signal: ctx.signal,
      }),
      "ElevenLabs voices",
    );
    return (json.voices ?? [])
      .filter((v): v is { voice_id: string; name?: string } => typeof v.voice_id === "string")
      .map((v) => ({ id: v.voice_id, name: v.name ?? v.voice_id }));
  },
  synthesize(input, config, ctx) {
    const values = fieldValues(elevenlabs, config);
    const url = `${baseUrl(values)}/v1/text-to-speech/${encodeURIComponent(
      input.voice,
    )}?output_format=mp3_44100_128`;
    return postJson(
      ctx,
      url,
      { "xi-api-key": values.apiKey ?? "" },
      {
        text: input.text,
        model_id: input.model,
        voice_settings: { speed: input.rate },
      },
    ).then((resp) => audioBody(resp, "ElevenLabs TTS"));
  },
};
