import { CHAT_VISUAL_MODES } from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import { chatVisualModeOptions, chatVisualModeSyncMessages } from "./chatVisualsAppearance";

const translate = createInterfaceTranslator({ language: "en", locale: "en-US" }).message;

describe("chat visuals appearance", () => {
  it.each(["en", "de", "fr"] as const)(
    "offers the same ordered modes with localized %s descriptions",
    (language) => {
      const options = chatVisualModeOptions(
        createInterfaceTranslator({ language, locale: language }).message,
      );
      expect(options.map((option) => option.mode)).toEqual(CHAT_VISUAL_MODES);
      expect(options.at(-1)?.label).toBe("Better T3");
      expect(
        options.every(
          (option) => option.description.length > 0 && !option.description.startsWith("settings."),
        ),
      ).toBe(true);
    },
  );

  it("distinguishes pending, failed, offline, and incompatible environments", () => {
    expect(
      chatVisualModeSyncMessages(
        {
          isSyncing: true,
          failedEnvironmentLabels: ["Failed server"],
          deferredEnvironmentLabels: ["Offline server"],
          unsupportedEnvironmentLabels: ["Old server"],
        },
        translate,
      ),
    ).toEqual([
      "Changes are waiting to sync with connected environments.",
      "Could not sync with Failed server. T3 Code will retry after reconnection.",
      "Waiting for Offline server to reconnect.",
      "This choice stays on this device for Old server. Update those servers to sync it.",
    ]);
  });

  it("describes a local choice without claiming synchronization", () => {
    expect(
      chatVisualModeSyncMessages(
        {
          isLocalOnly: true,
          isSyncing: false,
          failedEnvironmentLabels: [],
          deferredEnvironmentLabels: [],
          unsupportedEnvironmentLabels: [],
        },
        translate,
      ),
    ).toEqual(["Saved on this device. Connect a compatible environment to sync your choice."]);
  });
});
