import { ProviderInstanceId } from "@t3tools/contracts";
import { enableAutoReasoning, selectManualReasoningEffort } from "@t3tools/shared/model";
import { describe, expect, it } from "@effect/vitest";

import {
  threadAutoReasoningEffort,
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

  it("shows the resolved Auto effort without exposing fallback state", () => {
    const selection = enableAutoReasoning({
      instanceId: ProviderInstanceId.make("codex"),
      model: "sol",
    });
    const run = {
      modelSelection: selection,
      resolvedModelSelection: selectManualReasoningEffort(selection, "high"),
      autoReasoning: { effort: "high", durationMs: 15, fallback: true, routerModel: null },
    };
    const resolvedAutoReasoning = {
      enabled: true,
      effectiveEffort: threadAutoReasoningEffort(selection, run) ?? undefined,
    };
    expect(resolvedAutoReasoning.effectiveEffort).toBe("high");
    expect(threadAutoReasoningEffort(selection, { modelSelection: selection })).toBeNull();
    expect(
      threadAutoReasoningEffort(selection, {
        ...run,
        modelSelection: selectManualReasoningEffort(selection, "medium"),
      }),
    ).toBeNull();
    expect(threadAutoReasoningEffort({ ...selection, model: "other" }, run)).toBeNull();
    expect(
      threadAutoReasoningEffort(selectManualReasoningEffort(selection, "low"), run),
    ).toBeNull();
    expect(
      threadAutoReasoningEffort(selection, {
        modelSelection: selection,
        resolvedModelSelection: run.resolvedModelSelection,
      }),
    ).toBe("high");
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
