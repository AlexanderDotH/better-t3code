import { describe, expect, it } from "@effect/vitest";

import { threadSettingsSummaryLabel } from "./thread-settings-summary";

describe("threadSettingsSummaryLabel", () => {
  it("shows Fetch in the compact composer summary when enabled", () => {
    expect(
      threadSettingsSummaryLabel({
        modelLabel: "Sol",
        optionDescriptors: [],
        runtimeMode: "auto",
        interactionMode: "default",
        fetchEnabled: true,
      }),
    ).toBe("Sol · Auto · Fetch");
  });
});
