import { describe, expect, it } from "@effect/vitest";

import {
  readAutoReasoningStatus,
  threadReasoningValueLabel,
  threadSettingsSummaryLabel,
} from "./thread-settings-summary";

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

  it("shows the same Auto effective and fallback status as web", () => {
    const autoReasoning = readAutoReasoningStatus([
      {
        kind: "runtime.warning",
        payload: { autoReasoningEffort: "low", autoReasoningFallback: true },
      },
      {
        kind: "auto-reasoning.resolved",
        payload: { autoReasoningEffort: "high", autoReasoningFallback: true },
      },
    ] as never);
    expect(
      threadSettingsSummaryLabel({
        modelLabel: "Sol",
        optionDescriptors: [],
        runtimeMode: "approval-required",
        interactionMode: "default",
        autoReasoning: autoReasoning!,
      }),
    ).toBe("Sol · Auto · High · Fallback · Supervised");
    expect(
      threadReasoningValueLabel({
        autoReasoningEnabled: false,
        manualLabel: "Medium",
        status: autoReasoning,
      }),
    ).toBe("Medium");
  });
});
