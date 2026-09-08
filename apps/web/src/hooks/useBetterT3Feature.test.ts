import {
  DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1,
  DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveBetterT3DeviceFeature } from "./useBetterT3Feature";

describe("resolveBetterT3DeviceFeature", () => {
  it("preserves clean-install and existing-install defaults", () => {
    expect(
      resolveBetterT3DeviceFeature(DEFAULT_CLEAN_BETTER_T3_SETTINGS_V1, "chat.workspaceCardDeck"),
    ).toBe(false);
    expect(
      resolveBetterT3DeviceFeature(
        DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
        "chat.workspaceCardDeck",
      ),
    ).toBe(true);
  });

  it("honors an explicit reversible override", () => {
    expect(
      resolveBetterT3DeviceFeature(
        {
          ...DEFAULT_EXISTING_BETTER_T3_SETTINGS_V1,
          flags: { "chat.workspaceCardDeck": false },
        },
        "chat.workspaceCardDeck",
      ),
    ).toBe(false);
  });
});
