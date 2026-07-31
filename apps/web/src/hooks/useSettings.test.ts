import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { mergeEnvironmentSettings, resolveEnvironmentIdentificationMode } from "./useSettings";

describe("resolveEnvironmentIdentificationMode", () => {
  it("keeps identification hidden until client settings hydrate", () => {
    expect(resolveEnvironmentIdentificationMode({ mode: "artwork", settingsHydrated: false })).toBe(
      "none",
    );
    expect(resolveEnvironmentIdentificationMode({ mode: "pill", settingsHydrated: true })).toBe(
      "pill",
    );
  });
});

describe("mergeEnvironmentSettings", () => {
  it("combines the selected environment's server settings with client preferences", () => {
    const serverSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      providerInstances: {
        [ProviderInstanceId.make("codex_remote")]: {
          driver: ProviderDriverKind.make("codex"),
          enabled: true,
        },
      },
    };
    const clientSettings = {
      ...DEFAULT_CLIENT_SETTINGS,
      favorites: [
        {
          provider: ProviderInstanceId.make("codex_remote"),
          model: "gpt-5.4",
        },
      ],
    };

    const settings = mergeEnvironmentSettings(serverSettings, clientSettings);

    expect(settings.providerInstances).toBe(serverSettings.providerInstances);
    expect(settings.favorites).toBe(clientSettings.favorites);
  });

  it("fills default provider settings when persisted server settings only contain provider instances", () => {
    const hyperagentId = ProviderInstanceId.make("hyperagent");
    const settings = mergeEnvironmentSettings(
      {
        providerInstances: {
          [hyperagentId]: {
            driver: ProviderDriverKind.make("hyperagent"),
            enabled: true,
          },
        },
      },
      DEFAULT_CLIENT_SETTINGS,
    );

    expect(settings.providers.codex.enabled).toBe(true);
    expect(settings.providers.claudeAgent.enabled).toBe(true);
    expect(settings.providerInstances[hyperagentId]?.enabled).toBe(true);
  });

  it("fully expands sparse persisted server settings before selectors read nested values", () => {
    const sparseSettings = {
      providerInstances: {
        [ProviderInstanceId.make("hyperagent")]: {
          driver: ProviderDriverKind.make("hyperagent"),
          enabled: true,
        },
      },
      providers: {
        codex: {
          enabled: false,
        },
      },
      backgroundActivity: {
        profile: "custom",
      },
      sourceControlWritingStyle: {
        mode: "custom",
      },
      textGenerationModelSelection: {
        instanceId: ProviderInstanceId.make("codex"),
      },
      parallelPlanReviewModelSelection: {
        model: "gpt-5.6-terra",
      },
      speechTranscription: {
        assemblyAi: {
          apiKey: {
            valueRedacted: true,
          },
        },
      },
      mcp: {},
      skills: {},
    } as unknown as Partial<ServerSettings>;

    const settings = mergeEnvironmentSettings(sparseSettings, DEFAULT_CLIENT_SETTINGS);

    expect(settings.providers.codex).toEqual({
      ...DEFAULT_SERVER_SETTINGS.providers.codex,
      enabled: false,
    });
    expect(settings.providers.claudeAgent).toEqual(DEFAULT_SERVER_SETTINGS.providers.claudeAgent);
    expect(settings.backgroundActivity).toEqual({
      ...DEFAULT_SERVER_SETTINGS.backgroundActivity,
      profile: "custom",
    });
    expect(settings.sourceControlWritingStyle).toEqual({
      ...DEFAULT_SERVER_SETTINGS.sourceControlWritingStyle,
      mode: "custom",
    });
    expect(settings.textGenerationModelSelection).toEqual(
      DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
    );
    expect(settings.parallelPlanReviewModelSelection).toEqual({
      ...DEFAULT_SERVER_SETTINGS.parallelPlanReviewModelSelection,
      model: "gpt-5.6-terra",
    });
    expect(settings.speechTranscription.assemblyAi.apiKey).toEqual({
      value: "",
      valueRedacted: true,
    });
    expect(settings.mcp.servers).toEqual([]);
    expect(settings.skills.disabledSkillIds).toEqual([]);
  });
});
