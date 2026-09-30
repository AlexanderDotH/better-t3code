import type {
  ResponseStreamingMode,
  ServerSettings,
  ServerSettingsPatch,
} from "@t3tools/contracts";

const RESPONSE_STREAMING_MODES = ["turn", "paragraph", "token"] as const;
const LEGACY_RESPONSE_STREAMING_MODES = ["turn", "token"] as const;

export function availableResponseStreamingModes(supportsModes: boolean) {
  return supportsModes ? RESPONSE_STREAMING_MODES : LEGACY_RESPONSE_STREAMING_MODES;
}

export function resolveResponseStreamingMode(
  settings: Pick<
    ServerSettings,
    "responseStreamingMode" | "enableLegacyTokenStreaming" | "enableAssistantStreaming"
  >,
  supportsModes: boolean,
): ResponseStreamingMode {
  if (supportsModes) return settings.responseStreamingMode;
  const legacyChoice = settings.enableLegacyTokenStreaming ?? settings.enableAssistantStreaming;
  // Optimistic legacy writes are normalized into the enum before the old server replies.
  return (legacyChoice ?? settings.responseStreamingMode === "token") ? "token" : "turn";
}

export function compatibleResponseStreamingSettingsPatch(
  patch: ServerSettingsPatch,
  supportsModes: boolean,
): ServerSettingsPatch {
  if (patch.responseStreamingMode === undefined) return patch;
  const {
    responseStreamingMode,
    enableLegacyTokenStreaming: _legacy,
    enableAssistantStreaming: _assistant,
    ...rest
  } = patch;
  return supportsModes
    ? { ...rest, responseStreamingMode }
    : { ...rest, enableLegacyTokenStreaming: responseStreamingMode === "token" };
}
