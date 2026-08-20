import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, type ProviderOptionDescriptor } from "@t3tools/contracts";
import { CODEX_CONTEXT_WINDOW_DESCRIPTOR } from "@t3tools/shared/model";
import { buildContextWindowSliderState } from "./ContextWindowPicker";
import { buildTraitsTriggerDisplay } from "./TraitsPicker";

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
      triggerLabel: "Context 1M",
    });
  });

  it("shows model default at the first context slider position", () => {
    expect(buildContextWindowSliderState(CODEX_CONTEXT_WINDOW_DESCRIPTOR)).toEqual({
      currentIndex: 0,
      currentLabel: "Model default",
      maxIndex: 19,
      progressPercent: 0,
      triggerLabel: "Context Default",
    });
  });

  it("renders Codex's Standard and Fast service tiers as fast mode", () => {
    const serviceTier = selectDescriptor(
      "serviceTier",
      [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ],
      "default",
    );

    expect(display([EFFORT, serviceTier])).toEqual({
      label: "High",
      showFastModeIcon: false,
    });
    expect(display([EFFORT, { ...serviceTier, currentValue: "priority" }])).toEqual({
      label: "High",
      showFastModeIcon: true,
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
});
