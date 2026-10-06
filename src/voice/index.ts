export { VoiceUnavailableError } from "./errors.ts";
export {
  CONTINUE_COMMANDS,
  degradedSpeech,
  isSpeechLanguagePref,
  previewText,
  resolveSpeechLanguage,
  SPEECH_LANGUAGES,
  type SpeechLanguage,
  type SpeechLanguagePref,
  speechLanguageName,
  speechLanguagePromptName,
  systemSpeechLanguage,
} from "./languages.ts";
export { Recorder } from "./recorder.ts";
export { SentenceChunker, splitSentences } from "./sentences.ts";
export { createSpeechSynth, type SpeechSynth } from "./speechSynth.ts";
export { transcribe } from "./stt.ts";
export {
  DEFAULT_VOICE,
  defaultVoice,
  speechVoice,
  type VoiceOptions,
  voiceGroupsOf,
  voiceLabel,
} from "./voices.ts";
