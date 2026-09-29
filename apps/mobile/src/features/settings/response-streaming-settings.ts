import type {
  ExecutionEnvironmentCapabilities,
  ResponseStreamingMode,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";

type StreamingCapabilities = Pick<ExecutionEnvironmentCapabilities, "responseStreamingModes">;
type StreamingSettings = Pick<
  ServerSettings,
  "responseStreamingMode" | "enableLegacyTokenStreaming" | "enableAssistantStreaming"
>;

export function mobileResponseStreamingMode(
  settings: StreamingSettings,
  capabilities: StreamingCapabilities,
): ResponseStreamingMode {
  if (capabilities.responseStreamingModes === true) return settings.responseStreamingMode;
  // Decoding supplies the new default even when an older server never sent this field.
  const tokenStreaming = settings.enableLegacyTokenStreaming ?? settings.enableAssistantStreaming;
  return tokenStreaming === true ? "token" : "turn";
}

export function mobileResponseStreamingSettingsPatch(
  mode: ResponseStreamingMode,
  capabilities: StreamingCapabilities,
): ServerSettingsPatch | null {
  if (capabilities.responseStreamingModes === true) return { responseStreamingMode: mode };
  if (mode === "paragraph") return null;
  return { enableLegacyTokenStreaming: mode === "token" };
}
