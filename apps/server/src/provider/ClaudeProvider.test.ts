import { assert, describe, it } from "@effect/vitest";
import {
  BUNDLED_CLAUDE_MODEL_CATALOG,
  normalizeClaudeCatalogEffort,
} from "./ClaudeModelCatalog.ts";

import { parseClaudeInitializationModels } from "./ClaudeProvider.ts";

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

  it("preserves an advertised xhigh effort for gateway models", () => {
    assert.strictEqual(
      normalizeClaudeCatalogEffort(
        BUNDLED_CLAUDE_MODEL_CATALOG,
        "xhigh",
        "claude-codex-gpt-5.6-sol",
      ),
      "xhigh",
    );
    assert.strictEqual(
      normalizeClaudeCatalogEffort(BUNDLED_CLAUDE_MODEL_CATALOG, "max", "claude-codex-gpt-5.6-sol"),
      "max",
    );
  });

  it("retains native Claude compatibility mappings", () => {
    assert.strictEqual(
      normalizeClaudeCatalogEffort(BUNDLED_CLAUDE_MODEL_CATALOG, "ultracode", "claude-fable-5"),
      "xhigh",
    );
    assert.strictEqual(
      normalizeClaudeCatalogEffort(BUNDLED_CLAUDE_MODEL_CATALOG, "ultrathink", "claude-fable-5"),
      undefined,
    );
    assert.strictEqual(
      normalizeClaudeCatalogEffort(BUNDLED_CLAUDE_MODEL_CATALOG, "xhigh", "claude-opus-4-7"),
      "max",
    );
    assert.strictEqual(
      normalizeClaudeCatalogEffort(BUNDLED_CLAUDE_MODEL_CATALOG, "xhigh", "custom-model"),
      "xhigh",
    );
    assert.strictEqual(
      normalizeClaudeCatalogEffort(BUNDLED_CLAUDE_MODEL_CATALOG, "max", "claude-sonnet-4-6"),
      "high",
    );
  });
});
