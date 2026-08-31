import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  T3_AUTO_REASONING_OPTION_ID,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { CODEX_CONTEXT_WINDOW_DESCRIPTOR, isAutoReasoningEnabled } from "@t3tools/shared/model";
import { buildContextWindowSliderState } from "./ContextWindowPicker";
import {
  applyReasoningChoice,
  buildTraitsTriggerDisplay,
  buildUnavailableModelOptionDescriptors,
  shouldOfferAutoReasoning,
} from "./TraitsPicker";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  currentValue: string,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  return { id, label: id, type: "select", options: [...options], currentValue };
}

function fastModeDescriptor(
  currentValue: boolean,
): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue };
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

function display(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
  autoReasoning?: {
    readonly enabled: boolean;
    readonly effectiveEffort?: string;
    readonly fallback?: boolean;
  },
) {
  return buildTraitsTriggerDisplay({
    provider: CODEX,
    descriptors,
    primarySelectDescriptorId: "reasoningEffort",
    ultrathinkPromptControlled: false,
    ...(autoReasoning ? { autoReasoning } : {}),
  });
}

describe("buildTraitsTriggerDisplay", () => {
  it("omits fast mode from the label entirely when it is off", () => {
    expect(display([EFFORT, fastModeDescriptor(false), CONTEXT_WINDOW])).toEqual({
      label: "High",
      showFastModeIcon: false,
    });
  });

  it("shows the bolt instead of a text label when fast mode is on", () => {
    expect(display([EFFORT, fastModeDescriptor(true), CONTEXT_WINDOW])).toEqual({
      label: "High",
      showFastModeIcon: true,
    });
  });

  it("maps the selected context choice to a stepped slider chip", () => {
    expect(buildContextWindowSliderState(CONTEXT_WINDOW)).toEqual({
      currentIndex: 1,
      currentLabel: "1M",
      maxIndex: 1,
      progressPercent: 100,
      triggerLabel: "1M",
    });
  });

  it("shows the numeric model default at its ordered context slider position", () => {
    expect(buildContextWindowSliderState(CODEX_CONTEXT_WINDOW_DESCRIPTOR)).toEqual({
      currentIndex: 10,
      currentLabel: "272K",
      maxIndex: 19,
      progressPercent: (10 / 19) * 100,
      triggerLabel: "272K",
    });
  });

  it("treats Codex standard and fast service tiers as fast mode states", () => {
    expect(display([EFFORT, serviceTierDescriptor("default")])).toEqual({
      label: "High",
      showFastModeIcon: false,
    });
    expect(display([EFFORT, serviceTierDescriptor("priority")])).toEqual({
      label: "High",
      showFastModeIcon: true,
    });
  });

  it("keeps other Codex service tiers in the label", () => {
    expect(display([EFFORT, serviceTierDescriptor("flex")])).toEqual({
      label: "High · Flex",
      showFastModeIcon: false,
    });
  });

  it("keeps the Codex service tier readable when it is the only trait", () => {
    expect(display([serviceTierDescriptor("default")])).toEqual({
      label: "Standard",
      showFastModeIcon: false,
    });
    expect(display([serviceTierDescriptor("priority")])).toEqual({
      label: "Fast",
      showFastModeIcon: false,
    });
  });

  it("keeps non-fastMode booleans as text labels", () => {
    const thinking: Extract<ProviderOptionDescriptor, { type: "boolean" }> = {
      id: "thinking",
      label: "Thinking",
      type: "boolean",
      currentValue: true,
    };
    expect(display([EFFORT, thinking])).toEqual({
      label: "High · Thinking On",
      showFastModeIcon: false,
    });
  });

  it("falls back to a text label when fast mode is the only trait", () => {
    expect(display([fastModeDescriptor(true)])).toEqual({
      label: "Fast",
      showFastModeIcon: false,
    });
    expect(display([fastModeDescriptor(false)])).toEqual({
      label: "Normal",
      showFastModeIcon: false,
    });
  });

  it("stays blank when descriptors resolve to no label and there is no fast mode", () => {
    // A select with neither a currentValue nor an isDefault option yields no
    // label. Without a fastMode descriptor present that must stay blank rather
    // than falling through to a bogus "Normal".
    const unresolved: Extract<ProviderOptionDescriptor, { type: "select" }> = {
      id: "effort",
      label: "effort",
      type: "select",
      options: [
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ],
    };
    expect(display([unresolved])).toEqual({ label: "", showFastModeIcon: false });
  });

  it("still renders the prompt-controlled ultrathink label alongside the bolt", () => {
    expect(
      buildTraitsTriggerDisplay({
        provider: CODEX,
        descriptors: [EFFORT, fastModeDescriptor(true)],
        primarySelectDescriptorId: "reasoningEffort",
        ultrathinkPromptControlled: true,
      }),
    ).toEqual({ label: "Ultrathink", showFastModeIcon: true });
  });

  it("shows Auto with the concrete fallback, effective effort, and fallback marker", () => {
    expect(display([EFFORT], { enabled: true })).toEqual({
      label: "Auto · High",
      showFastModeIcon: false,
    });
    expect(display([EFFORT], { enabled: true, effectiveEffort: "max" })).toEqual({
      label: "Auto · Max",
      showFastModeIcon: false,
    });
    expect(display([EFFORT], { enabled: true, effectiveEffort: "high", fallback: true })).toEqual({
      label: "Auto · High · Fallback",
      showFastModeIcon: false,
    });
  });
});

describe("Auto reasoning choices", () => {
  const selection = {
    instanceId: ProviderInstanceId.make("codex_work"),
    model: "gpt-5.6-sol",
    options: [{ id: "reasoningEffort", value: "high" }],
  } as const;

  it("is offered only for a Codex reasoning-effort descriptor", () => {
    expect(shouldOfferAutoReasoning(CODEX, EFFORT)).toBe(true);
    expect(shouldOfferAutoReasoning(CODEX, { ...EFFORT, options: [] })).toBe(false);
    expect(shouldOfferAutoReasoning(ProviderDriverKind.make("claudeAgent"), EFFORT)).toBe(false);
    expect(shouldOfferAutoReasoning(CODEX, serviceTierDescriptor("default"))).toBe(false);
  });

  it("keeps the concrete fallback under Auto and removes Auto on a manual choice", () => {
    const automatic = applyReasoningChoice(selection, T3_AUTO_REASONING_OPTION_ID);
    expect(isAutoReasoningEnabled(automatic)).toBe(true);
    expect(automatic.options).toContainEqual({ id: "reasoningEffort", value: "high" });

    const manual = applyReasoningChoice(automatic, "max");
    expect(isAutoReasoningEnabled(manual)).toBe(false);
    expect(manual.options).toContainEqual({ id: "reasoningEffort", value: "max" });
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
        label: "Variant",
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
