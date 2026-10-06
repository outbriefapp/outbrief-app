import { EMPTY_TEMPLATE, synthesizeWithTemplate } from "../template.ts";
import type { TtsEngine } from "../types.ts";

export const CUSTOM_ENGINE = "custom";

/**
 * 自定义接口: the user's own HTTP request template (`template.ts`). The voice is whatever the
 * API calls one; it fills `{{voice}}`. The rate fills `{{speed}}`, so any range the API takes works.
 */
export const custom: TtsEngine = {
  id: CUSTOM_ENGINE,
  name: "Custom",
  category: "custom",
  site: { zh: "自定义 HTTP 请求", en: "Your own HTTP request" },
  docs: "",
  fields: [],
  models: [],
  voices: () => [],
  customVoice: true,
  defaultVoice: () => "",
  rate: { min: 0.5, max: 2 },
  synthesize: (input, config, ctx) =>
    synthesizeWithTemplate(config.request ?? EMPTY_TEMPLATE, input, ctx),
};
