import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ModelSelection, type ServerConfig } from "@t3tools/contracts";

import {
  buildModelOptions,
  filterStartedThreadModelOptions,
  groupByProvider,
  resolveDefaultableModelSelection,
  resolveNewTaskModelSelection,
  resolveSelectableModelSelection,
  type ModelOption,
} from "./modelOptions";

describe("mobile model options", () => {
  it("keeps unsupported OpenRouter models visible with non-selectable metadata", () => {
    const config = {
      providers: [
        {
          instanceId: "openrouter",
          driver: "openrouter",
          displayName: "OpenRouter",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "openai/no-tools",
              name: "No tools",
              isCustom: false,
              isSelectable: false,
              unavailableReason: "No tool support",
              capabilities: {
                outputModalities: ["text"],
                toolSupport: { tools: false, parallelToolCalls: false, toolChoice: false },
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    expect(buildModelOptions(config, null)[0]).toMatchObject({
      providerDriver: "openrouter",
      isSelectable: false,
      unavailableReason: "No tool support",
    });
    expect(
      resolveSelectableModelSelection(config, {
        instanceId: ProviderInstanceId.make("openrouter"),
        model: "openai/no-tools",
      }),
    ).toBeNull();
  });

  it("normalizes live gateway GPT defaults and preserves persisted per-thread options", () => {
    const config = {
      providers: [
        {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          displayName: "Claude",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "claude-codex-gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              isCustom: false,
              isDefault: true,
              capabilities: {
                optionDescriptors: [
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
                  {
                    id: "fastMode",
                    label: "Fast Mode",
                    type: "boolean",
                    currentValue: false,
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [defaults] = buildModelOptions(config, null);
    const [persisted] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-codex-gpt-5.6-sol",
      options: [
        { id: "effort", value: "high" },
        { id: "fastMode", value: true },
      ],
    });

    expect(defaults?.selection.options).toEqual([
      { id: "effort", value: "low" },
      { id: "fastMode", value: false },
    ]);
    expect(defaults?.isDefault).toBe(true);
    expect(persisted?.selection.options).toEqual([
      { id: "effort", value: "high" },
      { id: "fastMode", value: true },
    ]);
  });

  it("preserves Auto Reasoning while normalizing live Codex options", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              capabilities: {
                optionDescriptors: [
                  {
                    id: "reasoningEffort",
                    label: "Reasoning",
                    type: "select",
                    options: [
                      { id: "low", label: "Low", isDefault: true },
                      { id: "high", label: "High" },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [model] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
      options: [
        { id: "reasoningEffort", value: "low" },
        { id: "t3AutoReasoning", value: true },
      ],
    });

    expect(model?.selection.options).toEqual([
      { id: "reasoningEffort", value: "low" },
      { id: "t3AutoReasoning", value: true },
    ]);
  });

  it("keeps started threads locked unless the environment capability is enabled", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [{ slug: "gpt-5.4", name: "GPT-5.4", capabilities: null }],
        },
        {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          displayName: "Claude",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [{ slug: "agent", name: "Agent", capabilities: null }],
        },
      ],
    } as unknown as ServerConfig;
    const currentSelection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.4",
    };
    const options = buildModelOptions(config, currentSelection);

    expect(
      filterStartedThreadModelOptions({
        options,
        currentSelection,
        hasStarted: true,
        allowMidChatProviderSwitching: false,
      }).map((option) => option.selection.instanceId),
    ).toEqual([ProviderInstanceId.make("codex")]);
    expect(
      filterStartedThreadModelOptions({
        options,
        currentSelection,
        hasStarted: true,
        allowMidChatProviderSwitching: true,
      }),
    ).toHaveLength(2);
  });

  it("keeps started threads within compatible continuation groups and new-thread constraints", () => {
    const provider = (input: {
      readonly driver?: string;
      readonly groupKey: string;
      readonly instanceId: string;
      readonly requiresNewThreadForModelChange?: boolean;
    }) => ({
      instanceId: input.instanceId,
      driver: input.driver ?? "codex",
      displayName: input.instanceId,
      enabled: true,
      installed: true,
      auth: { status: "authenticated" },
      continuation: { groupKey: input.groupKey },
      requiresNewThreadForModelChange: input.requiresNewThreadForModelChange ?? false,
      models: [{ slug: "shared-model", name: input.instanceId, capabilities: null }],
    });
    const config = {
      providers: [
        provider({ instanceId: "codex_a", groupKey: "codex-compatible" }),
        provider({ instanceId: "codex_b", groupKey: "codex-compatible" }),
        provider({ instanceId: "codex_other", groupKey: "other" }),
        provider({
          instanceId: "codex_locked",
          groupKey: "codex-compatible",
          requiresNewThreadForModelChange: true,
        }),
        provider({
          instanceId: "claude",
          driver: "claudeAgent",
          groupKey: "codex-compatible",
        }),
      ],
    } as unknown as ServerConfig;
    const currentSelection = {
      instanceId: ProviderInstanceId.make("codex_a"),
      model: "shared-model",
    };
    const options = buildModelOptions(config, currentSelection);

    expect(
      filterStartedThreadModelOptions({
        options,
        currentSelection,
        hasStarted: true,
        allowMidChatProviderSwitching: false,
      }).map((option) => option.providerKey),
    ).toEqual(["codex_a", "codex_b"]);

    expect(
      filterStartedThreadModelOptions({
        options,
        currentSelection: {
          instanceId: ProviderInstanceId.make("codex_locked"),
          model: "shared-model",
        },
        hasStarted: true,
        allowMidChatProviderSwitching: false,
      }).map((option) => option.providerKey),
    ).toEqual(["codex_locked"]);
  });

  it("groups models by provider and flags legacy entries", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-5.6-sol",
              name: "GPT-5.6 Sol",
              isCustom: false,
              capabilities: null,
            },
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              isLegacy: true,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    expect(groupByProvider(buildModelOptions(config, null))).toMatchObject([
      {
        providerKey: "codex",
        providerLabel: "Codex",
        models: [
          { key: "codex:gpt-5.6-sol", label: "GPT-5.6 Sol", subtitle: "", isLegacy: false },
          { key: "codex:gpt-5.4", label: "GPT-5.4", isLegacy: true },
        ],
      },
    ]);
  });

  it("distinguishes same-name OpenCode models without changing their routing", () => {
    const sources = [
      { id: "anthropic", label: "Anthropic" },
      { id: "github-copilot", label: "GitHub Copilot" },
      { id: "opencode", label: "OpenCode Zen" },
    ];
    const config = {
      providers: [
        {
          instanceId: "opencode_work",
          driver: "opencode",
          displayName: "OpenCode Work",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: sources.map((source) => ({
            slug: `${source.id}/claude-fable-5`,
            name: "Claude Fable 5",
            subProvider: source.label,
            isCustom: false,
            capabilities: null,
          })),
        },
      ],
    } as unknown as ServerConfig;
    const selection = {
      instanceId: ProviderInstanceId.make("opencode_work"),
      model: "github-copilot/claude-fable-5",
    };

    const options = buildModelOptions(config, selection);

    expect(options).toMatchObject(
      sources.map((source) => ({
        key: `opencode_work:${source.id}/claude-fable-5`,
        label: "Claude Fable 5",
        subtitle: source.label,
        providerLabel: "OpenCode Work",
        selection: {
          instanceId: "opencode_work",
          model: `${source.id}/claude-fable-5`,
        },
      })),
    );
    expect(groupByProvider(options)).toEqual([
      { providerKey: "opencode_work", providerLabel: "OpenCode Work", models: options },
    ]);
  });

  it("normalizes a legacy fallback selection against current capabilities", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "gpt-test",
              name: "GPT Test",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "serviceTier",
                    label: "Service Tier",
                    type: "select",
                    options: [
                      { id: "default", label: "Standard", isDefault: true },
                      { id: "priority", label: "Fast" },
                    ],
                    currentValue: "default",
                  },
                ],
              },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const [option] = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-test",
      options: [{ id: "fastMode", value: true }],
    });

    expect(option?.capabilities?.optionDescriptors?.[0]?.id).toBe("serviceTier");
    expect(option?.selection.options).toEqual([{ id: "serviceTier", value: "priority" }]);
  });

  it("stores Standard explicitly and drops Fast for an unsupported Codex model", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            {
              slug: "fast-model",
              name: "Fast model",
              isCustom: false,
              capabilities: {
                optionDescriptors: [
                  {
                    id: "serviceTier",
                    label: "Service Tier",
                    type: "select",
                    options: [
                      { id: "default", label: "Standard", isDefault: true },
                      { id: "priority", label: "Fast" },
                    ],
                    currentValue: "default",
                  },
                ],
              },
            },
            {
              slug: "standard-model",
              name: "Standard model",
              isCustom: false,
              capabilities: { optionDescriptors: [] },
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const options = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "standard-model",
      options: [{ id: "serviceTier", value: "priority" }],
    });

    expect(
      options.find((option) => option.selection.model === "fast-model")?.selection.options,
    ).toEqual([{ id: "serviceTier", value: "default" }]);
    expect(
      options.find((option) => option.selection.model === "standard-model")?.selection.options,
    ).toBeUndefined();
  });

  it("drops Fast when a persisted Codex model is no longer in the catalog", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [{ slug: "current-model", name: "Current", capabilities: null }],
        },
      ],
    } as unknown as ServerConfig;

    const options = buildModelOptions(config, {
      instanceId: ProviderInstanceId.make("codex"),
      model: "removed-model",
      options: [{ id: "serviceTier", value: "priority" }],
    });

    expect(
      options.find((option) => option.selection.model === "removed-model")?.selection.options,
    ).toBeUndefined();
  });

  it("rejects stored selections whose provider is not usable", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [],
        },
        {
          instanceId: "claudeAgent",
          driver: "claudeAgent",
          enabled: false,
          installed: true,
          auth: { status: "authenticated" },
          models: [],
        },
      ],
    } as unknown as ServerConfig;

    const usable = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    };
    const disabled = {
      instanceId: ProviderInstanceId.make("claudeAgent"),
      model: "claude-sonnet-5",
    };
    const removed = {
      instanceId: ProviderInstanceId.make("codex_personal"),
      model: "gpt-5.6-sol",
    };

    expect(resolveSelectableModelSelection(config, usable)).toBe(usable);
    expect(resolveSelectableModelSelection(config, disabled)).toBeNull();
    expect(resolveSelectableModelSelection(config, removed)).toBeNull();
    // No config (environment offline) — nothing to validate against.
    expect(resolveSelectableModelSelection(null, disabled)).toBe(disabled);
  });

  it("keeps legacy models out of implicit defaults", () => {
    const config = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          displayName: "Codex",
          enabled: true,
          installed: true,
          auth: { status: "authenticated" },
          models: [
            { slug: "gpt-5.6-sol", name: "GPT-5.6 Sol", isCustom: false, capabilities: null },
            {
              slug: "gpt-5.4",
              name: "GPT-5.4",
              isCustom: false,
              isLegacy: true,
              capabilities: null,
            },
          ],
        },
      ],
    } as unknown as ServerConfig;

    const current = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" };
    const legacy = { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" };

    expect(resolveDefaultableModelSelection(config, current)).toBe(current);
    // A legacy last-used selection falls through to the provider default.
    expect(resolveDefaultableModelSelection(config, legacy)).toBeNull();
    // Offline: nothing to validate against, selection passes through.
    expect(resolveDefaultableModelSelection(null, legacy)).toBe(legacy);
  });

  it("resolves new tasks from draft, project, sticky, then provider defaults", () => {
    const draft = { instanceId: ProviderInstanceId.make("codex"), model: "draft" };
    const project = { instanceId: ProviderInstanceId.make("codex"), model: "project" };
    const sticky = { instanceId: ProviderInstanceId.make("codex"), model: "sticky" };
    const providerDefault = {
      selection: { instanceId: ProviderInstanceId.make("codex"), model: "default" },
      isDefault: true,
    } as ModelOption;
    const resolve = (
      draftSelection: ModelSelection | null,
      projectDefaultSelection: ModelSelection | null,
      stickySelection: ModelSelection | null,
    ) =>
      resolveNewTaskModelSelection({
        draftSelection,
        projectDefaultSelection,
        stickySelection,
        modelOptions: [providerDefault],
      });

    expect(resolve(draft, project, sticky)).toBe(draft);
    expect(resolve(null, project, sticky)).toBe(project);
    expect(resolve(null, null, sticky)).toBe(sticky);
    expect(resolve(null, null, null)).toBe(providerDefault.selection);
  });
});
