import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ServerConfig } from "@t3tools/contracts";

import { buildModelOptions, filterStartedThreadModelOptions } from "./modelOptions";

describe("mobile model options", () => {
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
    expect(persisted?.selection.options).toEqual([
      { id: "effort", value: "high" },
      { id: "fastMode", value: true },
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
    expect(option?.selection.options).toEqual([{ id: "serviceTier", value: "default" }]);
  });
});
