import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { applyServerSettingsPatch } from "@t3tools/shared/serverSettings";
import { describe, expect, it } from "vite-plus/test";

import {
  availableResponseStreamingModes,
  compatibleResponseStreamingSettingsPatch,
  resolveResponseStreamingMode,
} from "./responseStreamingSettings";

describe("response streaming compatibility", () => {
  it("limits older servers to their supported turn and token choices", () => {
    expect(availableResponseStreamingModes(false)).toEqual(["turn", "token"]);
    expect(availableResponseStreamingModes(true)).toEqual(["turn", "paragraph", "token"]);
  });

  it.each([
    { enableLegacyTokenStreaming: true, enableAssistantStreaming: false, expected: "token" },
    { enableLegacyTokenStreaming: false, enableAssistantStreaming: true, expected: "turn" },
    { enableAssistantStreaming: true, expected: "token" },
    { enableAssistantStreaming: false, expected: "turn" },
  ] as const)(
    "reads an older server's returned streaming preference: %j",
    ({ expected, ...legacy }) => {
      expect(resolveResponseStreamingMode({ ...DEFAULT_SERVER_SETTINGS, ...legacy }, false)).toBe(
        expected,
      );
    },
  );

  it("uses the explicit modern choice even when the response retains legacy aliases", () => {
    expect(
      resolveResponseStreamingMode(
        {
          ...DEFAULT_SERVER_SETTINGS,
          responseStreamingMode: "paragraph",
          enableLegacyTokenStreaming: true,
        },
        true,
      ),
    ).toBe("paragraph");
    expect(
      compatibleResponseStreamingSettingsPatch(
        { responseStreamingMode: "paragraph", enableLegacyTokenStreaming: true },
        true,
      ),
    ).toEqual({ responseStreamingMode: "paragraph" });
  });

  it.each(["turn", "token"] as const)(
    "keeps an optimistic legacy %s choice visible before the server response arrives",
    (mode) => {
      const patch = compatibleResponseStreamingSettingsPatch(
        { responseStreamingMode: mode },
        false,
      );
      expect(patch).toEqual({ enableLegacyTokenStreaming: mode === "token" });
      const optimistic = applyServerSettingsPatch(
        { ...DEFAULT_SERVER_SETTINGS, enableAssistantStreaming: mode !== "token" },
        patch,
      );
      expect(resolveResponseStreamingMode(optimistic, false)).toBe(mode);
    },
  );
});
