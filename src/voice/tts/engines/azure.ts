import { withAzureRetry } from "../../azureRequest.ts";
import { type AzureTokenProvider, azureTokens } from "../../azureToken.ts";
import { VoiceHttpError } from "../../errors.ts";
import { buildSsml } from "../../ssml.ts";
import { defaultVoice, voiceGroupsOf } from "../../voices.ts";
import type { TtsEngine } from "../types.ts";

const OUTPUT_FORMAT = "audio-24khz-48kbitrate-mono-mp3";

async function readAudio(resp: Response): Promise<Blob> {
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new VoiceHttpError(`Azure TTS HTTP ${resp.status}: ${body.slice(0, 200)}`, resp.status);
  }
  const type = resp.headers.get("content-type") ?? "";
  const audio = await resp.arrayBuffer();
  if (audio.byteLength === 0 || !/^(audio\/|application\/octet-stream)/i.test(type)) {
    throw new VoiceHttpError(`Azure TTS returned no audio (${type || "no content-type"})`);
  }
  return new Blob([audio], { type: "audio/mpeg" });
}

/**
 * Azure neural voices through the free translator-app JWT ("path B", `azureToken.ts`): no account,
 * the default engine. Voices are the plugin's per-language list; the rate is SSML `<prosody>`.
 * Azure has CORS, and the token is shared with speech recognition, so it keeps its own fetch and
 * request policy (`withAzureRetry`: 401 → new token).
 */
export function createAzureEngine(tokens: AzureTokenProvider = azureTokens): TtsEngine {
  return {
    id: "azure",
    name: "Azure",
    category: "free",
    site: { zh: "免费 · 无需账号", en: "Free · no account" },
    docs: "https://learn.microsoft.com/azure/ai-services/speech-service/rest-text-to-speech",
    fields: [],
    models: [],
    voices: (language) =>
      voiceGroupsOf(language).flatMap((g) =>
        g.voices.map((v) => ({ id: v.id, name: v.label, gender: g.gender })),
      ),
    customVoice: false,
    defaultVoice,
    // speech-synthesis-markup-voice: prosody rate "within 0.5 to 2 times the original audio".
    rate: { min: 0.5, max: 2 },
    ownsRequestPolicy: true,
    synthesize(input, _config, ctx) {
      const ssml = buildSsml(input.text, input);
      return withAzureRetry(
        tokens,
        async ({ region, token }) =>
          readAudio(
            await globalThis.fetch(
              `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
              {
                method: "POST",
                headers: {
                  Authorization: token,
                  "Content-Type": "application/ssml+xml",
                  "X-Microsoft-OutputFormat": OUTPUT_FORMAT,
                },
                body: ssml,
                signal: ctx.signal,
              },
            ),
          ),
        ctx.signal,
      );
    },
  };
}

export const azure = createAzureEngine();
