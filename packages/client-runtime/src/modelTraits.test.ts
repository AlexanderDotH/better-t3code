import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { enableAutoReasoning } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";
import { buildTraitsTriggerDisplay } from "./modelTraits.ts";

const reasoning: ProviderOptionDescriptor = {
  id: "reasoningEffort",
  label: "Reasoning",
  type: "select",
  currentValue: "low",
  options: [
    { id: "low", label: "Low" },
    { id: "high", label: "High" },
  ],
};
const selected = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "reasoning-model",
  options: [{ id: "reasoningEffort", value: "low" }],
};
const input = {
  provider: ProviderDriverKind.make("codex"),
  descriptors: [reasoning],
  primarySelectDescriptorId: "reasoningEffort",
  ultrathinkPromptControlled: false,
  modelSelection: selected,
};

describe("automatic reasoning trait display", () => {
  it("shows only the current resolved effort while preserving manual selections and speed", () => {
    expect(buildTraitsTriggerDisplay(input)).toEqual({ label: "Low", speedLabel: null });
    const automatic = { ...input, modelSelection: enableAutoReasoning(selected) };
    expect(buildTraitsTriggerDisplay(automatic)).toEqual({ label: "Auto", speedLabel: null });
    expect(buildTraitsTriggerDisplay({ ...automatic, autoReasoningEffort: "high" })).toEqual({
      label: "Auto · High",
      speedLabel: null,
    });
    expect(buildTraitsTriggerDisplay({ ...automatic, autoReasoningEffort: "removed" })).toEqual({
      label: "Auto",
      speedLabel: null,
    });
    expect(
      buildTraitsTriggerDisplay({
        ...input,
        autoReasoningEnabled: true,
        autoReasoningEffort: "high",
        autoLabel: "Automatisch",
      }),
    ).toEqual({ label: "Automatisch · High", speedLabel: null });
    expect(
      buildTraitsTriggerDisplay({
        ...automatic,
        autoReasoningEffort: "high",
        descriptors: [
          reasoning,
          { id: "fastMode", label: "Speed", type: "boolean", currentValue: true },
        ],
      }),
    ).toEqual({ label: "Auto · High Fast", speedLabel: "Fast" });
    expect(
      buildTraitsTriggerDisplay({
        ...automatic,
        provider: ProviderDriverKind.make("claudeAgent"),
        autoReasoningEffort: "high",
      }),
    ).toEqual({ label: "Low", speedLabel: null });
  });
});
