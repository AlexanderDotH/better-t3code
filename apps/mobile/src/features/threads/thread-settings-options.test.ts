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
  it("hides prompt-injected and workflow-trigger choices, keeping declared order", () => {
    expect(selectableChoices(effortDescriptor).map((choice) => choice.id)).toEqual([
      "low",
      "medium",
      "high",
    ]);
  });

  it("adds Auto only to the Codex reasoning-effort picker", () => {
    const reasoningEffort = { ...effortDescriptor, id: "reasoningEffort" };
    expect(
      threadReasoningChoices(ProviderDriverKind.make("codex"), reasoningEffort)[0],
    ).toMatchObject({ id: T3_AUTO_REASONING_OPTION_ID, label: "Auto" });
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
