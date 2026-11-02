import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { buildProviderOptionSelectionsFromDescriptors } from "@t3tools/shared/model";
import {
  applyReasoningChoice,
  buildTraitsTriggerDisplay,
  buildUnavailableModelOptionDescriptors,
  getTraitsSectionVisibility,
  shouldOfferAutoReasoning,
} from "./TraitsPicker";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  currentValue: string,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", options: [...options], currentValue };
}

function serviceTierDescriptor(
  currentValue: "default" | "priority" | "flex",
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return {
    id: "serviceTier",
    label: "Service Tier",
    type: "select",
    options: [
      { id: "default", label: "Standard", isDefault: true },
      { id: "priority", label: "Fast" },
      { id: "flex", label: "Flex" },
    ],
    currentValue,
  };
}

const EFFORT = selectDescriptor(
  "reasoningEffort",
  [
    { id: "high", label: "High" },
    { id: "max", label: "Max" },
  ],
  "high",
);
const CONTEXT_WINDOW = selectDescriptor(
  "contextWindow",
  [
    { id: "200k", label: "200k" },
    { id: "1m", label: "1M" },
  ],
  "1m",
);

const CODEX = ProviderDriverKind.make("codex");

function display(descriptors: ReadonlyArray<ProviderOptionDescriptor>) {
  return buildTraitsTriggerDisplay({
    provider: CODEX,
    descriptors,
    primarySelectDescriptorId: "reasoningEffort",
    ultrathinkPromptControlled: false,
  });
}

describe("buildTraitsTriggerDisplay", () => {
  it("offers Auto only for supported Codex reasoning controls and shows the resolved effort", () => {
    expect(shouldOfferAutoReasoning(CODEX, EFFORT)).toBe(true);
    expect(shouldOfferAutoReasoning(ProviderDriverKind.make("claudeAgent"), EFFORT)).toBe(false);
    expect(shouldOfferAutoReasoning(CODEX, CONTEXT_WINDOW)).toBe(false);
    expect(shouldOfferAutoReasoning(CODEX, { ...EFFORT, options: [] })).toBe(false);
    expect(
      buildTraitsTriggerDisplay({
        provider: CODEX,
        descriptors: [EFFORT, serviceTierDescriptor("priority")],
        primarySelectDescriptorId: "reasoningEffort",
        ultrathinkPromptControlled: false,
        autoReasoningEnabled: true,
        autoReasoningEffort: "max",
      }),
    ).toEqual({ label: "Auto · Max Fast", speedLabel: "Fast" });
  });

  it("retains other traits when enabling Auto and removes Auto when choosing manual reasoning", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("codex-custom"),
      model: "test-model",
      options: [{ id: "contextWindow", value: "1m" }],
    };
    const autoSelection = applyReasoningChoice(selection, "t3AutoReasoning");
    expect(autoSelection.options).toEqual([
      { id: "contextWindow", value: "1m" },
      { id: "t3AutoReasoning", value: true },
    ]);
    expect(applyReasoningChoice(autoSelection, "max")).toEqual({
      ...selection,
      options: [
        { id: "contextWindow", value: "1m" },
        { id: "reasoningEffort", value: "max" },
      ],
    });
  });

  it("hides only the native context control while retaining its value for other trait edits", () => {
    for (const hideContextWindow of [true, false]) {
      const traits = getTraitsSectionVisibility({
        provider: CODEX,
        models: [
          {
            slug: "test-model",
            name: "Test model",
            isCustom: false,
            capabilities: { optionDescriptors: [EFFORT, CONTEXT_WINDOW] },
          },
        ],
        model: "test-model",
        modelOptions: [{ id: "contextWindow", value: "1m" }],
        planModeEnabled: true,
        hideContextWindow,
      });

      expect(display(traits.visibleDescriptors).label).toBe(
        hideContextWindow ? "High" : "High · 1M",
      );
      expect(traits.selectDescriptors.map(({ id }) => id)).toEqual(
        hideContextWindow ? ["reasoningEffort"] : ["reasoningEffort", "contextWindow"],
      );
      const updated = traits.descriptors.map((descriptor) =>
        descriptor.id === "reasoningEffort" && descriptor.type === "select"
          ? { ...descriptor, currentValue: "max" }
          : descriptor,
      );
      expect(buildProviderOptionSelectionsFromDescriptors(updated)).toEqual([
        { id: "reasoningEffort", value: "max" },
        { id: "contextWindow", value: "1m" },
      ]);
    }
  });
});

describe("buildUnavailableModelOptionDescriptors", () => {
  it("shows only saved values without inventing alternatives", () => {
    expect(
      buildUnavailableModelOptionDescriptors([
        { id: "variant", value: "max" },
        { id: "agent", value: "build" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual([
      {
        id: "variant",
        label: "Reasoning",
        type: "select",
        options: [{ id: "max", label: "max" }],
        currentValue: "max",
      },
      {
        id: "agent",
        label: "Agent",
        type: "select",
        options: [{ id: "build", label: "build" }],
        currentValue: "build",
      },
      {
        id: "fastMode",
        label: "Fast Mode",
        type: "boolean",
        currentValue: true,
      },
    ]);
  });
});
