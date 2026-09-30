import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileResponseStreamingMode,
  mobileResponseStreamingSettingsPatch,
} from "./response-streaming-settings";

describe("mobile streaming compatibility", () => {
  it.each([{}, { responseStreamingModes: false }])(
    "reads older snapshots from the legacy aliases when capabilities are %j",
    (capabilities) => {
      expect(mobileResponseStreamingMode(DEFAULT_SERVER_SETTINGS, capabilities)).toBe("turn");
      expect(
        mobileResponseStreamingMode(
          {
            ...DEFAULT_SERVER_SETTINGS,
            enableAssistantStreaming: true,
          },
          capabilities,
        ),
      ).toBe("token");
      expect(
        mobileResponseStreamingMode(
          {
            ...DEFAULT_SERVER_SETTINGS,
            enableLegacyTokenStreaming: false,
            enableAssistantStreaming: true,
          },
          capabilities,
        ),
      ).toBe("turn");
      expect(
        mobileResponseStreamingMode(
          {
            ...DEFAULT_SERVER_SETTINGS,
            enableLegacyTokenStreaming: true,
            enableAssistantStreaming: false,
          },
          capabilities,
        ),
      ).toBe("token");
    },
  );

  it.each(["turn", "paragraph", "token"] as const)(
    "trusts the canonical %s preference on current servers despite legacy aliases",
    (responseStreamingMode) => {
      const capabilities = { responseStreamingModes: true };
      expect(
        mobileResponseStreamingMode(
          {
            ...DEFAULT_SERVER_SETTINGS,
            responseStreamingMode,
            enableLegacyTokenStreaming: responseStreamingMode !== "token",
            enableAssistantStreaming: responseStreamingMode !== "token",
          },
          capabilities,
        ),
      ).toBe(responseStreamingMode);
      expect(mobileResponseStreamingSettingsPatch(responseStreamingMode, capabilities)).toEqual({
        responseStreamingMode,
      });
    },
  );

  it.each([{}, { responseStreamingModes: false }])(
    "writes only supported legacy preferences when capabilities are %j",
    (capabilities) => {
      expect(mobileResponseStreamingSettingsPatch("token", capabilities)).toEqual({
        enableLegacyTokenStreaming: true,
      });
      expect(mobileResponseStreamingSettingsPatch("turn", capabilities)).toEqual({
        enableLegacyTokenStreaming: false,
      });
      expect(mobileResponseStreamingSettingsPatch("paragraph", capabilities)).toBeNull();
    },
  );
});
