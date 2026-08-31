import { describe, expect, it } from "vite-plus/test";

import { resolveAssemblyAiVoiceInputAvailability } from "./voiceInputAvailability";

describe("resolveAssemblyAiVoiceInputAvailability", () => {
  it("requires the Better T3 flag, capability, and credential before dictation is configured", () => {
    expect(
      resolveAssemblyAiVoiceInputAvailability({
        featureEnabled: true,
        environmentSettingsVersion: 1,
        apiKeyConfigured: true,
      }),
    ).toEqual({ available: true, configured: true });
    expect(
      resolveAssemblyAiVoiceInputAvailability({
        featureEnabled: false,
        environmentSettingsVersion: 1,
        apiKeyConfigured: true,
      }),
    ).toEqual({ available: false, configured: false });
    expect(
      resolveAssemblyAiVoiceInputAvailability({
        featureEnabled: true,
        environmentSettingsVersion: undefined,
        apiKeyConfigured: true,
      }),
    ).toEqual({ available: false, configured: false });
  });
});
