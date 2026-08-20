import { describe, expect, it } from "vite-plus/test";
import {
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ServerProviderModel,
} from "@t3tools/contracts";
import {
  getComposerPromptInjectionState,
  getComposerProviderState,
  renderProviderContextWindowPicker,
  renderProviderTraitsMenuContent,
  renderProviderTraitsPicker,
} from "./composerProviderState";
import { DraftId } from "../../composerDraftStore";

// Everything in composerProviderState is now data-driven by the model's
// optionDescriptors, so these tests use a single synthetic provider/model and
// vary only the descriptor shape per scenario.

const PROVIDER: ProviderDriverKind = ProviderDriverKind.make("codex");
const MODEL = "test-model";

function selectDescriptor(
  id: string,
  options: ReadonlyArray<{ id: string; label: string; isDefault?: boolean }>,
  promptInjectedValues?: ReadonlyArray<string>,
): Extract<ProviderOptionDescriptor, { type: "select" }> {
  const defaultId = options.find((option) => option.isDefault)?.id;
  return {
    id,
    label: id,
    type: "select",
    options: [...options],
    ...(defaultId ? { currentValue: defaultId } : {}),
    ...(promptInjectedValues && promptInjectedValues.length > 0
      ? { promptInjectedValues: [...promptInjectedValues] }
      : {}),
  };
}

function booleanDescriptor(id: string): Extract<ProviderOptionDescriptor, { type: "boolean" }> {
  return { id, label: id, type: "boolean" };
}

function modelWith(
  descriptors: ReadonlyArray<ProviderOptionDescriptor>,
): ReadonlyArray<ServerProviderModel> {
  return [
    { slug: MODEL, name: MODEL, isCustom: false, capabilities: { optionDescriptors: descriptors } },
  ];
}

function selections(
  ...entries: Array<[string, string | boolean]>
): ReadonlyArray<ProviderOptionSelection> {
  return entries.map(([id, value]) => ({ id, value }));
}

const GPT_56_SOL_DESCRIPTORS: ReadonlyArray<ProviderOptionDescriptor> = [
  {
    id: "effort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "low", label: "Low", isDefault: true },
      { id: "medium", label: "Medium" },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
      { id: "max", label: "Max" },
    ],
  },
  { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
];

const GPT_54_DESCRIPTORS: ReadonlyArray<ProviderOptionDescriptor> = [
  {
    id: "effort",
    label: "Reasoning",
    type: "select",
    options: [
      { id: "low", label: "Low" },
      { id: "medium", label: "Medium", isDefault: true },
      { id: "high", label: "High" },
      { id: "xhigh", label: "Extra High" },
    ],
  },
  { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
];

const GPT_54_MINI_DESCRIPTORS = GPT_54_DESCRIPTORS.filter(
  (descriptor) => descriptor.id !== "fastMode",
);

const ULTRATHINK_FRAME_CLASSES = {
  composerFrameClassName: "ultrathink-frame",
  composerSurfaceClassName: "shadow-[0_0_0_1px_rgba(255,255,255,0.07)_inset]",
  modelPickerIconClassName: "ultrathink-chroma",
} as const;

describe("getComposerProviderState", () => {
  it("upgrades legacy Codex fast mode to the canonical service tier", () => {
    const models = modelWith([
      selectDescriptor("serviceTier", [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ]),
    ]);

    expect(
      getComposerProviderState({
        provider: PROVIDER,
        model: MODEL,
        models,
        modelOptions: selections(["fastMode", true]),
      }).modelOptionsForDispatch,
    ).toEqual(selections(["serviceTier", "priority"]));
  });

  it("dispatches Standard explicitly for a fast-capable Codex model", () => {
    const models = modelWith([
      selectDescriptor("serviceTier", [
        { id: "default", label: "Standard", isDefault: true },
        { id: "priority", label: "Fast" },
      ]),
    ]);

    expect(
      getComposerProviderState({
        provider: PROVIDER,
        model: MODEL,
        models,
        modelOptions: undefined,
      }).modelOptionsForDispatch,
    ).toEqual(selections(["serviceTier", "default"]));
  });

  it("derives a stable prompt injection state for ordinary prompt edits", () => {
    expect(getComposerPromptInjectionState("Investigate this failure")).toBe("none");
    expect(getComposerPromptInjectionState("Ultrathink:\nInvestigate this failure")).toBe(
      "ultrathink",
    );
  });

  it("returns descriptor defaults when no selections are provided", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
      ]),
      modelOptions: undefined,
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"]),
    });
  });

  it("uses gateway GPT reasoning and Normal inference defaults and preserves explicit choices", () => {
    const defaults = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith(GPT_56_SOL_DESCRIPTORS),
      modelOptions: undefined,
    });
    const persisted = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith(GPT_56_SOL_DESCRIPTORS),
      modelOptions: selections(["effort", "high"], ["fastMode", true]),
    });

    expect(defaults).toMatchObject({
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", false]),
    });
    expect(persisted).toMatchObject({
      promptEffort: "high",
      modelOptionsForDispatch: selections(["effort", "high"], ["fastMode", true]),
    });
  });

  it("drops stale GPT options when the next model does not advertise them", () => {
    const miniState = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith(GPT_54_MINI_DESCRIPTORS),
      modelOptions: selections(["effort", "high"], ["fastMode", true]),
    });
    const nonReasoningState = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      modelOptions: selections(["effort", "high"], ["fastMode", true]),
    });

    expect(miniState.modelOptionsForDispatch).toEqual(selections(["effort", "high"]));
    expect(nonReasoningState.modelOptionsForDispatch).toBeUndefined();
  });

  it("uses the next GPT model default when its reasoning ladder no longer supports max", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith(GPT_54_DESCRIPTORS),
      modelOptions: selections(["effort", "max"], ["fastMode", true]),
    });

    expect(state).toMatchObject({
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"], ["fastMode", true]),
    });
  });

  it("lets selections override defaults and propagates them through dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [
          { id: "low", label: "Low" },
          { id: "high", label: "High", isDefault: true },
        ]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "low"], ["fastMode", true]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "low",
      modelOptionsForDispatch: selections(["effort", "low"], ["fastMode", true]),
    });
  });

  it("preserves selections that match defaults so deepMerge can overwrite prior state", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        booleanDescriptor("fastMode"),
      ]),
      modelOptions: selections(["effort", "high"], ["fastMode", false]),
    });

    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["fastMode", false]),
    );
  });

  it("drops selections for descriptors the model does not declare", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([booleanDescriptor("thinking")]),
      modelOptions: selections(["effort", "max"], ["thinking", false]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: selections(["thinking", false]),
    });
  });

  it("derives promptEffort from the first select descriptor and preserves all others for dispatch", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
        selectDescriptor("contextWindow", [
          { id: "200k", label: "200k", isDefault: true },
          { id: "1m", label: "1M" },
        ]),
        selectDescriptor("agent", [
          { id: "build", label: "Build", isDefault: true },
          { id: "plan", label: "Plan" },
        ]),
      ]),
      modelOptions: selections(["agent", "plan"]),
    });

    expect(state.promptEffort).toBe("high");
    expect(state.modelOptionsForDispatch).toEqual(
      selections(["effort", "high"], ["contextWindow", "200k"], ["agent", "plan"]),
    );
  });

  it("does not treat a Codex context-only selection as reasoning effort", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("contextWindow", [
          { id: "default", label: "Model default", isDefault: true },
          { id: "262144", label: "256K" },
        ]),
      ]),
      modelOptions: selections(["contextWindow", "262144"]),
    });

    expect(state.promptEffort).toBeNull();
    expect(state.modelOptionsForDispatch).toEqual(selections(["contextWindow", "262144"]));
  });

  it("returns undefined dispatch options when the model declares no descriptors", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([]),
      modelOptions: selections(["anything", "value"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: null,
      modelOptionsForDispatch: undefined,
    });
  });

  it("adds ultrathink class names when the prompt triggers a promptInjectedValues descriptor", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor(
          "effort",
          [
            { id: "medium", label: "Medium" },
            { id: "high", label: "High", isDefault: true },
            { id: "ultrathink", label: "Ultrathink" },
          ],
          ["ultrathink"],
        ),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: selections(["effort", "medium"]),
    });

    expect(state).toEqual({
      provider: PROVIDER,
      promptEffort: "medium",
      modelOptionsForDispatch: selections(["effort", "medium"]),
      ...ULTRATHINK_FRAME_CLASSES,
    });
  });

  it("does not add ultrathink class names when the descriptor has no promptInjectedValues", () => {
    const state = getComposerProviderState({
      provider: PROVIDER,
      model: MODEL,
      models: modelWith([
        selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
      ]),
      promptInjectionState: getComposerPromptInjectionState(
        "Ultrathink:\nInvestigate this failure",
      ),
      modelOptions: undefined,
    });

    expect(state).not.toHaveProperty("composerFrameClassName");
    expect(state).not.toHaveProperty("composerSurfaceClassName");
    expect(state).not.toHaveProperty("modelPickerIconClassName");
  });
});

describe("provider traits render guards", () => {
  it("returns null when no thread target is provided", () => {
    const models = modelWith([
      selectDescriptor("effort", [{ id: "high", label: "High", isDefault: true }]),
    ]);
    const args = {
      provider: PROVIDER,
      model: MODEL,
      models,
      modelOptions: undefined,
      prompt: "",
      onPromptChange: () => {},
    };

    expect(renderProviderTraitsPicker(args)).toBeNull();
    expect(renderProviderTraitsMenuContent(args)).toBeNull();
  });

  it("renders Codex context as its own composer control", () => {
    const args = {
      provider: PROVIDER,
      draftId: DraftId.make("draft-context-window"),
      model: MODEL,
      models: modelWith([
        selectDescriptor("contextWindow", [
          { id: "default", label: "Model default", isDefault: true },
          { id: "262144", label: "256K" },
        ]),
      ]),
      modelOptions: selections(["contextWindow", "262144"]),
      prompt: "",
      onPromptChange: () => {},
    };

    expect(renderProviderContextWindowPicker(args)).not.toBeNull();
    expect(renderProviderTraitsPicker(args)).toBeNull();
  });
});
