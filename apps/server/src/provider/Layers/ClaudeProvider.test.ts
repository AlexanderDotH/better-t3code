import type { ModelCapabilities } from "@t3tools/contracts";
import { createModelCapabilities } from "@t3tools/shared/model";
import { assert, describe, it } from "@effect/vitest";

import {
  getClaudeModelCapabilities,
  normalizeClaudeCliEffort,
  parseClaudeInitializationModels,
  resolveClaudeEffort,
} from "./ClaudeProvider.ts";

function effortCapabilities(input: {
  readonly values: ReadonlyArray<string>;
  readonly defaultValue: string;
}): ModelCapabilities {
  return createModelCapabilities({
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: input.values.map((value) => ({
          id: value,
          label: value,
          isDefault: value === input.defaultValue,
        })),
      },
    ],
  });
}

describe("ClaudeProvider helpers", () => {
  it("preserves supported runtime model metadata and rejects malformed rows", () => {
    const models = parseClaudeInitializationModels([
      {
        value: "claude-codex-gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        resolvedModel: "gpt-5.6-sol",
        description: "Latest coding model",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        supportsAdaptiveThinking: true,
        supportsFastMode: false,
        supportsAutoMode: true,
      },
      {
        value: "partially-valid",
        displayName: "Partially Valid",
        resolvedModel: 42,
        supportedEffortLevels: ["low", 42, "", "high"],
        supportsFastMode: "yes",
      },
      null,
      { value: "missing-display-name" },
      { value: 42, displayName: "Invalid value" },
    ]);

    assert.deepStrictEqual(models, [
      {
        value: "claude-codex-gpt-5.6-sol",
        displayName: "GPT-5.6 Sol",
        resolvedModel: "gpt-5.6-sol",
        description: "Latest coding model",
        supportsEffort: true,
        supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
        supportsAdaptiveThinking: true,
        supportsFastMode: false,
        supportsAutoMode: true,
      },
      {
        value: "partially-valid",
        displayName: "Partially Valid",
        supportedEffortLevels: ["low", "high"],
      },
    ]);
  });

  it("uses the advertised effort default when the selection is absent or unsupported", () => {
    const caps = effortCapabilities({ values: ["low", "high", "xhigh"], defaultValue: "low" });

    assert.strictEqual(resolveClaudeEffort(caps, undefined), "low");
    assert.strictEqual(resolveClaudeEffort(caps, "unsupported"), "low");
    assert.strictEqual(resolveClaudeEffort(caps, "xhigh"), "xhigh");
  });

  it("preserves an advertised xhigh effort for gateway models", () => {
    const gatewayCaps = effortCapabilities({
      values: ["low", "medium", "high", "xhigh", "max"],
      defaultValue: "medium",
    });

    assert.strictEqual(
      normalizeClaudeCliEffort("xhigh", "claude-codex-gpt-5.6-sol", gatewayCaps),
      "xhigh",
    );
    assert.strictEqual(
      normalizeClaudeCliEffort("max", "claude-codex-gpt-5.6-sol", gatewayCaps),
      "max",
    );
  });

  it("retains native Claude compatibility mappings", () => {
    assert.strictEqual(normalizeClaudeCliEffort("ultracode", "claude-fable-5"), "xhigh");
    assert.strictEqual(normalizeClaudeCliEffort("ultrathink", "claude-fable-5"), undefined);
    assert.strictEqual(
      normalizeClaudeCliEffort(
        "xhigh",
        "claude-opus-4-7",
        getClaudeModelCapabilities("claude-opus-4-7"),
      ),
      "max",
    );
    assert.strictEqual(normalizeClaudeCliEffort("xhigh", "custom-model"), "max");
    assert.strictEqual(normalizeClaudeCliEffort("max", "claude-sonnet-4-6"), "high");
  });
});
