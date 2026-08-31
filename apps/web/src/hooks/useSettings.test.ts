import {
  DEFAULT_SERVER_SETTINGS,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { type ClientSettingsPatch, DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts/settings";
import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSidebarLayout } from "../components/ThreadSidebarSelection";
import {
  mergeClientSettingsPatch,
  mergeEnvironmentSettings,
  resolveEnvironmentIdentificationMode,
} from "./useSettings";

const CLIENT_BETTER_T3_MIRROR_CASES = [
  ["experimentalFetch", "agent.fetch"],
  ["experimentalParallelPlanImplementation", "agent.parallelPlanImplementation"],
  ["planModeEnabled", "agent.planMode"],
  ["improvePromptBeforeSend", "agent.promptImprovement"],
  ["showExpandedComposerControls", "agent.expandedComposerControls"],
  ["showReasoning", "agent.reasoningVisibility"],
  ["legacySidebarEnabled", "chat.classicSidebar"],
] as const;

describe("mergeClientSettingsPatch", () => {
  it("keeps Better T3 initialization and unrelated flags for a sparse toggle patch", () => {
    const current = {
      ...DEFAULT_CLIENT_SETTINGS,
      betterT3Device: {
        version: 1 as const,
        initialization: "existing-install-migration" as const,
        flags: { "chat.cardMorphing": true },
      },
    };

    const next = mergeClientSettingsPatch(current, {
      betterT3Device: { flags: { "chat.workspaceCardDeck": false } },
    });

    expect(next.betterT3Device).toEqual({
      version: 1,
      initialization: "existing-install-migration",
      flags: {
        "chat.cardMorphing": true,
        "chat.workspaceCardDeck": false,
      },
    });
  });

  it.each(CLIENT_BETTER_T3_MIRROR_CASES)(
    "repairs %s legacy writes into the %s V1 flag",
    (legacyKey, featureId) => {
      const next = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
        [legacyKey]: true,
      } as ClientSettingsPatch);

      expect(next[legacyKey]).toBe(true);
      expect(next.betterT3Device.flags[featureId]).toBe(true);
    },
  );

  it.each(CLIENT_BETTER_T3_MIRROR_CASES)(
    "mirrors explicit %s V1 writes back to %s for older consumers",
    (legacyKey, featureId) => {
      const next = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
        betterT3Device: { flags: { [featureId]: true } },
      });

      expect(next.betterT3Device.flags[featureId]).toBe(true);
      expect(next[legacyKey]).toBe(true);
    },
  );

  it.each(CLIENT_BETTER_T3_MIRROR_CASES)(
    "lets an explicit V1 flag win over a conflicting %s value for %s",
    (legacyKey, featureId) => {
      const next = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
        [legacyKey]: true,
        betterT3Device: { flags: { [featureId]: false } },
      } as ClientSettingsPatch);

      expect(next[legacyKey]).toBe(false);
      expect(next.betterT3Device.flags[featureId]).toBe(false);
    },
  );

  it("keeps sequential Classic sidebar writes consistent for the actual layout consumer", () => {
    const oldPageWrite = mergeClientSettingsPatch(DEFAULT_CLIENT_SETTINGS, {
      legacySidebarEnabled: true,
    });
    expect(resolveThreadSidebarLayout(oldPageWrite.legacySidebarEnabled)).toBe("classic");
    expect(oldPageWrite.betterT3Device.flags["chat.classicSidebar"]).toBe(true);

    const newPageWrite = mergeClientSettingsPatch(oldPageWrite, {
      betterT3Device: { flags: { "chat.classicSidebar": false } },
    });
    expect(resolveThreadSidebarLayout(newPageWrite.legacySidebarEnabled)).toBe("current");
    expect(newPageWrite.betterT3Device.flags["chat.classicSidebar"]).toBe(false);

    const mixedVersionWrite = mergeClientSettingsPatch(newPageWrite, {
      legacySidebarEnabled: true,
      betterT3Device: { flags: { "chat.classicSidebar": false } },
    });
    expect(resolveThreadSidebarLayout(mixedVersionWrite.legacySidebarEnabled)).toBe("current");
    expect(mixedVersionWrite.betterT3Device.flags["chat.classicSidebar"]).toBe(false);

    const oldPageWriteAgain = mergeClientSettingsPatch(mixedVersionWrite, {
      legacySidebarEnabled: true,
    });
    expect(resolveThreadSidebarLayout(oldPageWriteAgain.legacySidebarEnabled)).toBe("classic");
    expect(oldPageWriteAgain.betterT3Device.flags["chat.classicSidebar"]).toBe(true);
  });
});

describe("resolveEnvironmentIdentificationMode", () => {
  it("keeps identification hidden until client settings hydrate", () => {
    expect(resolveEnvironmentIdentificationMode({ mode: "artwork", settingsHydrated: false })).toBe(
      "none",
    );
    expect(resolveEnvironmentIdentificationMode({ mode: "pill", settingsHydrated: true })).toBe(
      "pill",
    );
  });

  it("uses a pill instead of artwork with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("pill");
  });

  it("respects none with a palette theme", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "none",
        settingsHydrated: true,
        paletteThemeActive: true,
      }),
    ).toBe("none");
  });

  it("keeps artwork when the palette theme opts into it", () => {
    expect(
      resolveEnvironmentIdentificationMode({
        mode: "artwork",
        settingsHydrated: true,
        paletteThemeActive: true,
        paletteThemeAllowsArtwork: true,
      }),
    ).toBe("artwork");
  });
});

describe("mergeEnvironmentSettings", () => {
  it("keeps the current sidebar as the default client preference", () => {
    const settings = mergeEnvironmentSettings(DEFAULT_SERVER_SETTINGS, DEFAULT_CLIENT_SETTINGS);

    expect(settings.legacySidebarEnabled).toBe(false);
  });

  it("preserves a hydrated classic sidebar preference", () => {
    const settings = mergeEnvironmentSettings(DEFAULT_SERVER_SETTINGS, {
      ...DEFAULT_CLIENT_SETTINGS,
      legacySidebarEnabled: true,
    });

    expect(settings.legacySidebarEnabled).toBe(true);
  });

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
    const customProviderId = ProviderInstanceId.make("custom_provider");
    const settings = mergeEnvironmentSettings(
      {
        providerInstances: {
          [customProviderId]: {
            driver: ProviderDriverKind.make("customDriver"),
            enabled: true,
          },
        },
      },
      DEFAULT_CLIENT_SETTINGS,
    );

    expect(settings.providers.codex.enabled).toBe(true);
    expect(settings.providers.claudeAgent.enabled).toBe(true);
    expect(settings.providerInstances[customProviderId]?.enabled).toBe(true);
  });

  it("fully expands sparse persisted server settings before selectors read nested values", () => {
    const sparseSettings = {
      providerInstances: {
        [ProviderInstanceId.make("custom_provider")]: {
          driver: ProviderDriverKind.make("customDriver"),
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
