import { describe, expect, it } from "@effect/vitest";

import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";

import { compileClaudeModelSelection } from "./claudeModelOptions.ts";
import type { ClaudeGatewayModelProfile } from "./provider/Drivers/ClaudeGatewayCatalog.ts";

const selection = (
  model: string,
  options: NonNullable<ModelSelection["options"]>,
): ModelSelection => ({
  instanceId: ProviderInstanceId.make("claude_test"),
  model,
  options,
});

describe("compileClaudeModelSelection", () => {
  it("switches a gateway model to its fast id and keeps Fast Mode out of Claude settings", () => {
    const profile: ClaudeGatewayModelProfile = {
      canonicalModelId: "gpt-5.6",
      baseModelId: "claude-codex-gpt-5.6",
      fastModelId: "claude-codex-gpt-5.6-fast",
      aliases: ["GPT 5.6"],
      defaultEffort: "high",
      capabilities: {
        optionDescriptors: [
          {
            id: "effort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "medium", label: "Medium" },
              { id: "high", label: "High", isDefault: true },
            ],
          },
          { id: "fastMode", label: "Fast Mode", type: "boolean", currentValue: false },
        ],
      },
    };
    const { fastModelId: _fastModelId, ...withoutFastModel } = profile;
    const compile = (options: NonNullable<ModelSelection["options"]>) =>
      compileClaudeModelSelection(selection("GPT 5.6", options), undefined, profile);

    expect(compile([{ id: "fastMode", value: true }])).toMatchObject({
      apiModelId: "claude-codex-gpt-5.6-fast",
      effort: "high",
      settings: {},
    });
    const standard = compile([{ id: "effort", value: "medium" }]);
    expect(standard).toMatchObject({ apiModelId: "claude-codex-gpt-5.6", effort: "medium" });
    expect(compile([{ id: "fastMode", value: true }]).queryIdentity).not.toBe(
      standard.queryIdentity,
    );
    expect(
      compileClaudeModelSelection(
        selection("GPT 5.6", [{ id: "fastMode", value: true }]),
        undefined,
        withoutFastModel,
      ).apiModelId,
    ).toBe("claude-codex-gpt-5.6");
  });

  it("compiles context, effort, and settings together", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-opus-4-6", [
          { id: "contextWindow", value: "1m" },
          { id: "effort", value: "max" },
          { id: "fastMode", value: true },
        ]),
      ),
    ).toMatchObject({
      apiModelId: "claude-opus-4-6[1m]",
      effort: "max",
      settings: { fastMode: true },
    });
  });

  it("uses the model default SDK effort alongside prompt-injected effort", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-sonnet-4-6", [{ id: "effort", value: "ultrathink" }]),
      ),
    ).toMatchObject({ effort: "high", promptEffort: "ultrathink" });
  });

  it("keeps explicit effort for models missing from the local catalog", () => {
    expect(
      compileClaudeModelSelection(
        selection("claude-pool-model-not-in-catalog", [{ id: "effort", value: "max" }]),
      ).effort,
    ).toBe("max");
    expect(
      compileClaudeModelSelection(selection("claude-pool-model-not-in-catalog", [])).effort,
    ).toBeUndefined();
  });
});
