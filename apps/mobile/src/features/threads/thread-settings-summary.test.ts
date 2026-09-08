import { describe, expect, it } from "@effect/vitest";

import { threadReasoningValueLabel, threadSettingsSummaryLabel } from "./thread-settings-summary";

describe("threadSettingsSummaryLabel", () => {
  it("shows Fetch in the compact composer summary when enabled", () => {
    expect(
      threadSettingsSummaryLabel({
        modelLabel: "Sol",
        optionDescriptors: [],
        runtimeMode: "approval-required",
        interactionMode: "default",
        fetchEnabled: true,
      }),
    ).toBe("Sol · Supervised · Fetch");
  });

  it("shows the resolved Auto effort without exposing fallback state", () => {
    const resolvedAutoReasoning = {
      enabled: true,
      effectiveEffort: "high",
      fallback: true,
    } as const;
    const resolvedReasoningLabelInput = {
      autoReasoningEnabled: true,
      manualLabel: "Medium",
      resolvedEffortLabel: "High",
    } as const;
    expect(
      threadSettingsSummaryLabel({
        modelLabel: "Sol",
        optionDescriptors: [],
        runtimeMode: "approval-required",
        interactionMode: "default",
        autoReasoning: resolvedAutoReasoning,
      }),
    ).toBe("Sol · Auto · High · Supervised");
    expect(threadReasoningValueLabel(resolvedReasoningLabelInput)).toBe("Auto · High");
    expect(
      threadReasoningValueLabel({
        autoReasoningEnabled: true,
        manualLabel: "Medium",
      }),
    ).toBe("Auto");
    expect(
      threadReasoningValueLabel({
        autoReasoningEnabled: false,
        manualLabel: "Medium",
      }),
    ).toBe("Medium");
  });
});
