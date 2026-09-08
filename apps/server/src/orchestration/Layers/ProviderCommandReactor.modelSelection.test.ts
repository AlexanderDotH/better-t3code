import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { describe, expect, it } from "vite-plus/test";

import { requiresProviderSessionRestartForModelSelectionChange } from "./ProviderCommandReactor.ts";

const codexSelection = (contextWindow: string) =>
  createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
    { id: "reasoningEffort", value: "high" },
    { id: "contextWindow", value: contextWindow },
  ]);

describe("requiresProviderSessionRestartForModelSelectionChange", () => {
  it("restarts Codex only when the applied context window changes", () => {
    expect(
      requiresProviderSessionRestartForModelSelectionChange({
        provider: ProviderDriverKind.make("codex"),
        previous: codexSelection("262144"),
        next: codexSelection("524288"),
        explicitlyRequested: false,
      }),
    ).toBe(true);
    expect(
      requiresProviderSessionRestartForModelSelectionChange({
        provider: ProviderDriverKind.make("codex"),
        previous: codexSelection("262144"),
        next: {
          ...codexSelection("262144"),
          options: [
            { id: "reasoningEffort", value: "max" },
            { id: "contextWindow", value: "262144" },
          ],
        },
        explicitlyRequested: true,
      }),
    ).toBe(false);
    expect(
      requiresProviderSessionRestartForModelSelectionChange({
        provider: ProviderDriverKind.make("codex"),
        previous: codexSelection("262144"),
        next: codexSelection("default"),
        explicitlyRequested: false,
      }),
    ).toBe(true);
    expect(
      requiresProviderSessionRestartForModelSelectionChange({
        provider: ProviderDriverKind.make("codex"),
        previous: undefined,
        next: codexSelection("default"),
        explicitlyRequested: false,
      }),
    ).toBe(false);
  });

  it("keeps Claude's existing explicit option-change restart behavior", () => {
    const previous = createModelSelection(
      ProviderInstanceId.make("claudeAgent"),
      "claude-sonnet-5",
      [{ id: "effort", value: "high" }],
    );
    const next = { ...previous, options: [{ id: "effort", value: "max" }] };

    expect(
      requiresProviderSessionRestartForModelSelectionChange({
        provider: ProviderDriverKind.make("claudeAgent"),
        previous,
        next,
        explicitlyRequested: true,
      }),
    ).toBe(true);
    expect(
      requiresProviderSessionRestartForModelSelectionChange({
        provider: ProviderDriverKind.make("claudeAgent"),
        previous,
        next,
        explicitlyRequested: false,
      }),
    ).toBe(false);
  });
});
