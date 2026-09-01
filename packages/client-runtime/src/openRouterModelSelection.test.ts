import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveOpenRouterBootstrapModelPatch } from "./openRouterModelSelection.ts";

function openRouterProvider(input: {
  readonly instanceId: ProviderInstanceId;
  readonly models: ReadonlyArray<string>;
}): ServerProvider {
  return {
    instanceId: input.instanceId,
    driver: ProviderDriverKind.make("openrouter"),
    enabled: true,
    installed: true,
    version: null,
    status: "warning",
    auth: { status: "authenticated" },
    checkedAt: "2026-08-25T00:00:00.000Z",
    models: input.models.map((slug) => ({
      slug,
      name: slug,
      isCustom: false,
      isSelectable: true,
      capabilities: {},
    })),
    slashCommands: [],
    skills: [],
  };
}

describe("resolveOpenRouterBootstrapModelPatch", () => {
  it("promotes the default instance when its first selectable model is chosen", () => {
    const instanceId = ProviderInstanceId.make("openrouter");
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providers: {
        ...DEFAULT_SERVER_SETTINGS.providers,
        openrouter: {
          ...DEFAULT_SERVER_SETTINGS.providers.openrouter,
          enabled: true,
          contextCompression: true,
        },
      },
    };

    const patch = resolveOpenRouterBootstrapModelPatch({
      settings,
      provider: openRouterProvider({ instanceId, models: ["openai/gpt-5.5"] }),
      model: "openai/gpt-5.5",
    });

    expect(patch?.providerInstances?.[instanceId]).toMatchObject({
      driver: ProviderDriverKind.make("openrouter"),
      enabled: true,
      config: {
        contextCompression: true,
        defaultModel: "openai/gpt-5.5",
      },
    });
    expect(patch?.providers?.openrouter).toEqual(DEFAULT_SERVER_SETTINGS.providers.openrouter);
  });

  it("updates only the selected custom instance and preserves its config", () => {
    const selectedId = ProviderInstanceId.make("openrouter_work");
    const otherId = ProviderInstanceId.make("openrouter_personal");
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [selectedId]: {
          driver: ProviderDriverKind.make("openrouter"),
          enabled: true,
          config: {
            protocol: "responses",
            defaultModel: "removed/model",
            customModels: ["team/preset"],
          },
        },
        [otherId]: {
          driver: ProviderDriverKind.make("openrouter"),
          enabled: true,
          config: { defaultModel: "anthropic/claude-sonnet" },
        },
      },
    };

    const patch = resolveOpenRouterBootstrapModelPatch({
      settings,
      provider: openRouterProvider({ instanceId: selectedId, models: ["openai/gpt-5.5"] }),
      model: "openai/gpt-5.5",
    });

    expect(patch?.providerInstances?.[selectedId]?.config).toEqual({
      protocol: "responses",
      defaultModel: "openai/gpt-5.5",
      customModels: ["team/preset"],
    });
    expect(patch?.providerInstances?.[otherId]).toBe(settings.providerInstances[otherId]);
    expect(patch?.providers).toBeUndefined();
  });

  it("does not replace a valid configured default during normal model switching", () => {
    const instanceId = ProviderInstanceId.make("openrouter_work");
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [instanceId]: {
          driver: ProviderDriverKind.make("openrouter"),
          enabled: true,
          config: { defaultModel: "anthropic/claude-sonnet" },
        },
      },
    };

    expect(
      resolveOpenRouterBootstrapModelPatch({
        settings,
        provider: openRouterProvider({
          instanceId,
          models: ["anthropic/claude-sonnet", "openai/gpt-5.5"],
        }),
        model: "openai/gpt-5.5",
      }),
    ).toBeNull();
  });
});
