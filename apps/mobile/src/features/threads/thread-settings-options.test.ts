import {
  getTraitSelectChange,
  getPromptControlledTraits,
} from "@t3tools/client-runtime/model-traits";
import {
  ProviderDriverKind,
  ProviderInstanceId,
  T3_AUTO_REASONING_OPTION_ID,
  type ProviderOptionDescriptor,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  applyThreadOptionChoice,
  selectableChoices,
  threadReasoningChoices,
} from "./thread-settings-options";

const effortDescriptor: Extract<ProviderOptionDescriptor, { type: "select" }> = {
  id: "effort",
  label: "Reasoning",
  type: "select",
  options: [
    { id: "low", label: "Low" },
    { id: "medium", label: "Medium", isDefault: true },
    { id: "high", label: "High" },
    { id: "ultrathink", label: "Ultrathink" },
    { id: "ultracode", label: "Ultracode" },
  ],
  currentValue: "high",
  promptInjectedValues: ["ultrathink"],
};

describe("selectableChoices", () => {
  // regression: #21406 bring model controls in line with web
  it("leaves out prompt-injected choices and keeps workflow choices in declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
      "ultracode",
    ]);
  });

  it("adds Auto only to the Codex reasoning-effort picker", () => {
    const reasoningEffort = { ...effortDescriptor, id: "reasoningEffort" };
    expect(threadReasoningChoices(ProviderDriverKind.make("codex"), reasoningEffort)[0]).toEqual({
      id: T3_AUTO_REASONING_OPTION_ID,
      label: "Auto",
      description: "Sets reasoning level based on your prompt input.",
    });
    expect(
      threadReasoningChoices(ProviderDriverKind.make("claudeAgent"), reasoningEffort).map(
        ({ id }) => id,
      ),
    ).not.toContain(T3_AUTO_REASONING_OPTION_ID);
    expect(
      threadReasoningChoices(ProviderDriverKind.make("codex"), effortDescriptor).map(
        ({ id }) => id,
      ),
    ).not.toContain(T3_AUTO_REASONING_OPTION_ID);
    expect(
      threadReasoningChoices(ProviderDriverKind.make("codex"), {
        ...reasoningEffort,
        options: [],
      }),
    ).toEqual([]);
  });

  it("preserves the concrete fallback for Auto and clears Auto for a manual choice", () => {
    const descriptor = { ...effortDescriptor, id: "reasoningEffort" };
    const manual = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    } as const;
    const automatic = applyThreadOptionChoice({
      selection: manual,
      descriptors: [descriptor],
      id: "reasoningEffort",
      value: T3_AUTO_REASONING_OPTION_ID,
    });

    expect(automatic?.options).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: T3_AUTO_REASONING_OPTION_ID, value: true },
    ]);
    expect(
      applyThreadOptionChoice({
        selection: automatic!,
        descriptors: [descriptor],
        id: "reasoningEffort",
        value: "medium",
      })?.options,
    ).toEqual([{ id: "reasoningEffort", value: "medium" }]);
  });
});

describe("prompt-controlled reasoning", () => {
  it("removes the prefix when choosing a regular effort and saves Ultracode as an option", () => {
    const descriptors = [effortDescriptor];
    const prompt = "Ultrathink:\nsolve it";
    expect(
      getTraitSelectChange(
        { ...getPromptControlledTraits(descriptors, prompt), descriptors },
        effortDescriptor,
        prompt,
        "ultracode",
      ),
    ).toEqual({ prompt: "solve it", modelOptions: [{ id: "effort", value: "ultracode" }] });
  });

  it("keeps body-controlled Ultrathink locked", () => {
    const descriptors = [effortDescriptor];
    const prompt = "please ultrathink about this";
    const selected = { ...getPromptControlledTraits(descriptors, prompt), descriptors };
    expect(selected.ultrathinkInBodyText).toBe(true);
    expect(getTraitSelectChange(selected, effortDescriptor, prompt, "low")).toBeNull();
  });
});
