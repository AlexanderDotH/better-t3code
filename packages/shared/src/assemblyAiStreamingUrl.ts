import type { AssemblyAiStreamingTokenResult } from "@t3tools/contracts";

export function buildAssemblyAiStreamingUrl(config: AssemblyAiStreamingTokenResult): string {
  const url = new URL(config.websocketUrl);
  url.searchParams.set("sample_rate", String(config.sampleRate));
  url.searchParams.set("encoding", config.encoding);
  url.searchParams.set("speech_model", config.speechModel);
  const isUniversalPro = config.speechModel === "universal-3-5-pro";
  if (isUniversalPro) {
    url.searchParams.set("prompt", config.context.prompt);
  } else {
    url.searchParams.set("format_turns", "true");
  }
  if (config.context.keyterms.length > 0) {
    url.searchParams.set("keyterms_prompt", JSON.stringify(config.context.keyterms));
  }
  const options = config.options;
  if (options) {
    url.searchParams.set("include_partial_turns", String(options.includePartialTurns));
    url.searchParams.set("min_turn_silence", String(options.minTurnSilence));
    url.searchParams.set("max_turn_silence", String(options.maxTurnSilence));
    url.searchParams.set("vad_threshold", String(options.vadThreshold));
    url.searchParams.set("voice_focus", options.voiceFocus);
    if (isUniversalPro) {
      url.searchParams.set("mode", options.streamingMode);
      url.searchParams.set("continuous_partials", String(options.continuousPartials));
      url.searchParams.set("interruption_delay", String(options.interruptionDelay));
      if (options.languageCodes.length > 0) {
        url.searchParams.set("language_codes", JSON.stringify(options.languageCodes));
      }
    }
  }
  url.searchParams.set("token", config.token);
  return url.toString();
}
