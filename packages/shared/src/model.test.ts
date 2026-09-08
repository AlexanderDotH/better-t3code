import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId, type ModelCapabilities } from "@t3tools/contracts";

import {
  applyClaudePromptEffortPrefix,
  buildExplicitProviderOptionSelectionsFromDescriptors,
  buildProviderOptionSelectionsFromDescriptors,
  CODEX_CONTEXT_WINDOW_CHOICES,
  createCodexContextWindowDescriptor,
  createModelCapabilities,
  createModelSelection,
  enableAutoReasoning,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  readCustomModelEntries,
  toCustomModelSetting,
  getProviderOptionBooleanSelectionValue,
  getProviderOptionStringSelectionValue,
  isAutoReasoningEnabled,
  normalizeCustomModelSlug,
  normalizeModelSlug,
  readAutoReasoningResolution,
  resolveCodexContextWindowTokens,
  selectManualReasoningEffort,
  stripAutoReasoning,
} from "./model.ts";

const codexCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "reasoningEffort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "xhigh", label: "Extra High" },
        { id: "high", label: "High", isDefault: true },
      ],
      currentValue: "high",
    },
    {
      id: "fastMode",
      label: "Fast Mode",
      type: "boolean",
    },
  ],
});

const claudeCaps: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [
    {
      id: "effort",
      label: "Reasoning",
      type: "select",
      options: [
        { id: "medium", label: "Medium" },
        { id: "high", label: "High", isDefault: true },
        { id: "ultrathink", label: "Ultrathink" },
      ],
      currentValue: "high",
      promptInjectedValues: ["ultrathink"],
    },
    {
      id: "contextWindow",
      label: "Context Window",
      type: "select",
      options: [
        { id: "200k", label: "200k" },
        { id: "1m", label: "1M", isDefault: true },
      ],
      currentValue: "1m",
    },
  ],
});

describe("descriptor helpers", () => {
  it("applies selection values to capability descriptors", () => {
    expect(
      getProviderOptionDescriptors({
        caps: claudeCaps,
        selections: [
          { id: "effort", value: "medium" },
          { id: "contextWindow", value: "200k" },
        ],
      }),
    ).toEqual([
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [
          { id: "medium", label: "Medium" },
          { id: "high", label: "High", isDefault: true },
          { id: "ultrathink", label: "Ultrathink" },
        ],
        currentValue: "medium",
        promptInjectedValues: ["ultrathink"],
      },
      {
        id: "contextWindow",
        label: "Context Window",
        type: "select",
        options: [
          { id: "200k", label: "200k" },
          { id: "1m", label: "1M", isDefault: true },
        ],
        currentValue: "200k",
      },
    ]);
  });

  it("builds wire-format option selections from descriptors", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });

    expect(buildProviderOptionSelectionsFromDescriptors(descriptors)).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);
  });

  it("builds dispatch options only from explicit selections", () => {
    const descriptors = getProviderOptionDescriptors({
      caps: codexCaps,
      selections: [{ id: "fastMode", value: true }],
    });

    expect(buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, undefined)).toBe(
      undefined,
    );
    expect(
      buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, [
        { id: "fastMode", value: true },
      ]),
    ).toEqual([{ id: "fastMode", value: true }]);
  });

  it("preserves reserved Auto reasoning when rebuilding provider options without retaining unknown options", () => {
    const selections = [
      { id: "t3AutoReasoning", value: true },
      { id: "removedOption", value: "old" },
    ];
    const descriptors = getProviderOptionDescriptors({ caps: codexCaps, selections });

    expect(buildProviderOptionSelectionsFromDescriptors(descriptors, selections)).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "t3AutoReasoning", value: true },
    ]);
    expect(buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, selections)).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "t3AutoReasoning", value: true },
    ]);
    expect(buildExplicitProviderOptionSelectionsFromDescriptors([], selections)).toEqual([
      { id: "t3AutoReasoning", value: true },
    ]);
    expect(
      buildExplicitProviderOptionSelectionsFromDescriptors(descriptors, [
        { id: "t3AutoReasoning", value: "true" },
      ]),
    ).toBeUndefined();
  });

  it("stores option selection arrays in model selections", () => {
    expect(
      createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ]),
    ).toEqual({
      instanceId: "codex",
      model: "gpt-5.4",
      options: [
        { id: "reasoningEffort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });
  });

  it("reads typed option selection values", () => {
    const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.4", [
      { id: "reasoningEffort", value: "high" },
      { id: "fastMode", value: true },
    ]);

    expect(getProviderOptionStringSelectionValue(selection.options, "reasoningEffort")).toBe(
      "high",
    );
    expect(getProviderOptionStringSelectionValue(selection.options, "fastMode")).toBeUndefined();
    expect(getProviderOptionBooleanSelectionValue(selection.options, "fastMode")).toBe(true);
    expect(
      getProviderOptionBooleanSelectionValue(selection.options, "reasoningEffort"),
    ).toBeUndefined();
    expect(getModelSelectionStringOptionValue(selection, "reasoningEffort")).toBe("high");
    expect(getModelSelectionBooleanOptionValue(selection, "fastMode")).toBe(true);
  });
});

describe("Auto Reasoning selections", () => {
  const selection = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
    { id: "reasoningEffort", value: "high" },
    { id: "serviceTier", value: "priority" },
  ]);

  it("enables Auto while preserving the concrete fallback effort", () => {
    const enabled = enableAutoReasoning(selection);

    expect(isAutoReasoningEnabled(enabled)).toBe(true);
    expect(enabled.options).toEqual([
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
      { id: "t3AutoReasoning", value: true },
    ]);
  });

  it("selects a manual effort and removes only the Auto marker", () => {
    expect(selectManualReasoningEffort(enableAutoReasoning(selection), "medium").options).toEqual([
      { id: "reasoningEffort", value: "medium" },
      { id: "serviceTier", value: "priority" },
    ]);
  });

  it("strips the T3 marker without changing provider-owned options", () => {
    expect(stripAutoReasoning(enableAutoReasoning(selection))).toEqual(selection);
  });

  it("reads only valid content-free resolutions for the requested turn", () => {
    const activities = [
      {
        kind: "runtime.warning",
        turnId: "turn-2",
        payload: { autoReasoningEffort: "max", autoReasoningFallback: false },
      },
      {
        kind: "auto-reasoning.resolved",
        turnId: "turn-1",
        payload: { autoReasoningEffort: "low", autoReasoningFallback: false },
      },
      {
        kind: "auto-reasoning.resolved",
        turnId: "turn-2",
        payload: { autoReasoningEffort: " high ", autoReasoningFallback: true },
      },
    ];

    expect(readAutoReasoningResolution(activities, "turn-2")).toEqual({
      effectiveEffort: "high",
      fallback: true,
    });
    expect(readAutoReasoningResolution(activities, "turn-missing")).toBeNull();
  });

  it("rejects malformed resolution activities", () => {
    expect(
      readAutoReasoningResolution([
        {
          kind: "auto-reasoning.resolved",
          payload: { autoReasoningEffort: "high", autoReasoningFallback: "false" },
        },
        {
          kind: "auto-reasoning.resolved",
          payload: { autoReasoningEffort: " ", autoReasoningFallback: false },
        },
      ]),
    ).toBeNull();
  });
});

describe("Codex context window", () => {
  it("offers stable ordered steps through exactly one million tokens", () => {
    expect(CODEX_CONTEXT_WINDOW_CHOICES).toHaveLength(20);
    expect(CODEX_CONTEXT_WINDOW_CHOICES[10]).toEqual({
      id: "default",
      label: "272K",
      description: "Model default",
      isDefault: true,
    });
    expect(CODEX_CONTEXT_WINDOW_CHOICES.at(-1)).toEqual({
      id: "1000000",
      label: "1M",
    });
  });

  it("caps selectable steps at the reported model maximum", () => {
    const descriptor = createCodexContextWindowDescriptor({
      defaultTokens: 272_000,
      maxTokens: 872_000,
      effectivePercent: 95,
    });

    expect(descriptor.currentValue).toBe("default");
    expect(descriptor.options.find((choice) => choice.id === "default")).toEqual({
      id: "default",
      label: "272K",
      description: "Model default",
      isDefault: true,
    });
    expect(descriptor.options.map((choice) => choice.label)).toContain("872K");
    expect(descriptor.options.map((choice) => choice.label)).not.toContain("896K");
    expect(descriptor.options.map((choice) => choice.label)).not.toContain("1M");
    expect(descriptor.options.at(-1)).toEqual({ id: "872000", label: "872K" });
    expect(descriptor.options.map((choice) => choice.label)).toEqual(
      [...descriptor.options]
        .sort(
          (left, right) =>
            Number(left.id === "default" ? 272_000 : left.id) -
            Number(right.id === "default" ? 272_000 : right.id),
        )
        .map((choice) => choice.label),
    );
  });

  it("uses a single numeric default tick when default and reported maximum are equal", () => {
    const descriptor = createCodexContextWindowDescriptor({
      defaultTokens: 128_000,
      maxTokens: 128_000,
    });

    expect(descriptor.options.find((choice) => choice.id === "default")).toEqual({
      id: "default",
      label: "128K",
      description: "Model default",
      isDefault: true,
    });
    expect(descriptor.options.filter((choice) => choice.label === "128K")).toHaveLength(1);
    expect(
      descriptor.options.every((choice) => choice.id === "default" || Number(choice.id) < 128_000),
    ).toBe(true);
    expect(descriptor.options.at(-1)).toEqual({
      id: "default",
      label: "128K",
      description: "Model default",
      isDefault: true,
    });
  });

  it("clamps a saved value above the model maximum to the maximum choice", () => {
    const descriptor = createCodexContextWindowDescriptor({
      defaultTokens: 272_000,
      maxTokens: 872_000,
      effectivePercent: 95,
    });

    expect(
      getProviderOptionDescriptors({
        caps: createModelCapabilities({ optionDescriptors: [descriptor] }),
        selections: [{ id: "contextWindow", value: "1000000" }],
      })[0],
    ).toMatchObject({ currentValue: "872000" });
  });

  it("resolves only bounded numeric selections to runtime token counts", () => {
    expect(
      resolveCodexContextWindowTokens(
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
          { id: "contextWindow", value: "262144" },
        ]),
      ),
    ).toBe(262_144);
    expect(
      resolveCodexContextWindowTokens(
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
          { id: "contextWindow", value: "default" },
        ]),
      ),
    ).toBeUndefined();
    expect(
      resolveCodexContextWindowTokens(
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
          { id: "contextWindow", value: "1000000" },
        ]),
      ),
    ).toBe(1_000_000);
    expect(
      resolveCodexContextWindowTokens(
        createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol", [
          { id: "contextWindow", value: "1000001" },
        ]),
      ),
    ).toBeUndefined();
  });
});

describe("applyClaudePromptEffortPrefix", () => {
  it("keeps slash commands intact when ultrathink is selected", () => {
    expect(applyClaudePromptEffortPrefix("/compact", "ultrathink")).toBe("/compact");
    expect(applyClaudePromptEffortPrefix(" /compact keep recent errors ", "ultrathink")).toBe(
      "/compact keep recent errors",
    );
    expect(applyClaudePromptEffortPrefix(" /review src/model.ts ", "ultrathink")).toBe(
      "/review src/model.ts",
    );
    expect(applyClaudePromptEffortPrefix("/security-review", "ultrathink")).toBe(
      "/security-review",
    );
    expect(applyClaudePromptEffortPrefix("/plugin:skill run", "ultrathink")).toBe(
      "/plugin:skill run",
    );
    expect(applyClaudePromptEffortPrefix("/deploy.prod to staging", "ultrathink")).toBe(
      "/deploy.prod to staging",
    );
  });

  it("still adds the ultrathink prefix to ordinary prompts", () => {
    expect(applyClaudePromptEffortPrefix("Investigate this failure", "ultrathink")).toBe(
      "Ultrathink:\nInvestigate this failure",
    );
    expect(applyClaudePromptEffortPrefix("/home/theo/app.ts crashed on load", "ultrathink")).toBe(
      "Ultrathink:\n/home/theo/app.ts crashed on load",
    );
  });
});

describe("readCustomModelEntries", () => {
  const capabilities: ModelCapabilities = {
    optionDescriptors: [
      {
        id: "effort",
        label: "Reasoning",
        type: "select",
        options: [{ id: "high", label: "High", isDefault: true }],
        currentValue: "high",
      },
    ],
  };

  it("resolves bare slugs and entries, trimming and deduplicating on slug", () => {
    expect(
      readCustomModelEntries([
        " bare ",
        { slug: "named", name: " Named ", capabilities },
        "bare",
        { slug: "named", name: "Second" },
        "",
        { name: "no slug" },
        42,
      ]),
    ).toEqual([
      { slug: "bare", name: "bare", capabilities: null },
      { slug: "named", name: "Named", capabilities },
    ]);
  });

  it("drops unparseable capabilities but keeps the entry", () => {
    expect(
      readCustomModelEntries([{ slug: "x", capabilities: { optionDescriptors: "nope" } }]),
    ).toEqual([{ slug: "x", name: "x", capabilities: null }]);
    expect(readCustomModelEntries("not a list")).toEqual([]);
  });

  it("writes the compact stored shape back", () => {
    expect(toCustomModelSetting({ slug: "x", name: "x", capabilities: null })).toBe("x");
    expect(
      toCustomModelSetting({ slug: "x", name: "x", capabilities: { optionDescriptors: [] } }),
    ).toBe("x");
    expect(toCustomModelSetting({ slug: "x", name: "X", capabilities })).toEqual({
      slug: "x",
      name: "X",
      capabilities,
    });
  });
});

describe("model slug normalization", () => {
  it("preserves exact custom slugs instead of expanding provider aliases", () => {
    const codex = ProviderDriverKind.make("codex");
    expect(normalizeModelSlug("5.4", codex)).toBe("gpt-5.4");
    expect(normalizeCustomModelSlug(" 5.4 ")).toBe("5.4");
  });
});
