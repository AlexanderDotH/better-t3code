import {
  BETTER_T3_FEATURE_REGISTRY,
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { expect, it } from "vite-plus/test";

import { buildBetterT3FeatureSearchItems } from "./BetterT3SettingsSearch";
import { buildBetterT3ControlStates } from "./BetterT3SettingsPanel.logic";
import { searchSettings } from "./settingsSearch";

it.each(["en", "de", "fr"] as const)(
  "finds every mode and its separate motion control in %s",
  (language) => {
    const translate = createInterfaceTranslator({ language, locale: language }).message;
    const controls = buildBetterT3ControlStates({
      registry: BETTER_T3_FEATURE_REGISTRY,
      device: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      environment: DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
      surface: "web",
      capabilities: {},
    });
    const items = buildBetterT3FeatureSearchItems(controls, translate);
    for (const mode of ["current", "classic", "better-t3"] as const) {
      expect(
        searchSettings(translate(`settings.chatVisuals.${mode}`), items).some(
          (item) => item.targetId === "chat.presentation",
        ),
      ).toBe(true);
    }
    expect(
      searchSettings(translate("betterT3.chat.presentationMotion.label"), items)[0]?.targetId,
    ).toBe("chat.presentationMotion");
  },
);
