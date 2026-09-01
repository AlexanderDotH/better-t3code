import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { vi } from "vite-plus/test";

vi.mock("react-native", () => ({ Platform: { OS: "ios" } }));
vi.mock("expo-secure-store", () => ({
  deleteItemAsync: vi.fn(),
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
}));

import {
  finalizeMobilePreferencesMigration,
  make,
  mergeMobilePreferencesPatch,
  resolveMobileSidebarSettlingPreferences,
  sanitizeMobilePreferences,
} from "./mobile-preferences";
import { MobileDatabase } from "./mobile-database";
import { MobileSecureStorage } from "./mobile-secure-storage";
import { resolveMobileThreadListLayout } from "../features/settings/appearance/threadListAppearance";

const MOBILE_BETTER_T3_MIRROR_CASES = [
  ["experimentalFetch", "agent.fetch"],
  ["experimentalParallelPlanImplementation", "agent.parallelPlanImplementation"],
  ["improvePromptBeforeSend", "agent.promptImprovement"],
  ["planModeEnabled", "agent.planMode"],
  ["legacyThreadListEnabled", "chat.classicSidebar"],
] as const;

function makeMemoryPreferenceDependencies() {
  let storedPreferences: Option.Option<{ readonly payload: string; readonly updatedAt: number }> =
    Option.none();
  const secureValues = new Map<string, string>();
  const database = MobileDatabase.of({
    loadCache: () => Effect.succeed(Option.none()),
    loadEnvironmentCacheUpdatedAt: () => Effect.succeed(Option.none()),
    saveCache: () => Effect.void,
    removeCache: () => Effect.void,
    clearCacheKind: () => Effect.void,
    clearEnvironmentCache: () => Effect.void,
    clearAllCaches: Effect.void,
    inspectCaches: Effect.succeed([]),
    loadPreferencesJson: Effect.sync(() => storedPreferences),
    savePreferencesJson: (payload, updatedAt) =>
      Effect.sync(() => {
        storedPreferences = Option.some({ payload, updatedAt });
      }),
  });
  const secureStorage = MobileSecureStorage.of({
    getItem: (key) => Effect.succeed(secureValues.get(key) ?? null),
    setItem: (key, value) =>
      Effect.sync(() => {
        secureValues.set(key, value);
      }),
    removeItem: (key) =>
      Effect.sync(() => {
        secureValues.delete(key);
      }),
  });
  return { database, secureStorage };
}

describe("sanitizeMobilePreferences", () => {
  it("uses disabled clean-install Better T3 defaults only when no preference store exists", () => {
    expect(finalizeMobilePreferencesMigration({}, "clean-install").betterT3Device).toEqual({
      version: 1,
      initialization: "clean-install",
      flags: {},
    });
    expect(
      finalizeMobilePreferencesMigration({}, "existing-install-migration").betterT3Device,
    ).toEqual({
      version: 1,
      initialization: "existing-install-migration",
      flags: {},
    });
  });

  it("keeps explicit Better T3 flags unchanged and drops malformed settings", () => {
    const explicit = {
      version: 1 as const,
      initialization: "clean-install" as const,
      flags: { "agent.fetch": true, "knowledge.graph": false },
    };
    expect(sanitizeMobilePreferences({ betterT3Device: explicit })).toEqual({
      betterT3Device: explicit,
    });
    expect(
      sanitizeMobilePreferences({
        betterT3Device: { version: 2, initialization: "legacy", flags: [] },
      } as never),
    ).toEqual({});
  });

  it("seeds missing flags from explicit legacy preferences without overriding V1", () => {
    expect(
      finalizeMobilePreferencesMigration(
        {
          experimentalFetch: true,
          experimentalParallelPlanImplementation: false,
          planModeEnabled: true,
          legacyThreadListEnabled: true,
        },
        "existing-install-migration",
      ).betterT3Device.flags,
    ).toEqual({
      "agent.fetch": true,
      "agent.parallelPlanImplementation": false,
      "agent.planMode": true,
      "chat.classicSidebar": true,
    });

    expect(
      finalizeMobilePreferencesMigration(
        {
          betterT3Device: {
            version: 1,
            initialization: "clean-install",
            flags: { "agent.fetch": false, "chat.classicSidebar": false },
          },
          experimentalFetch: true,
          legacyThreadListEnabled: true,
          planModeEnabled: true,
        },
        "existing-install-migration",
      ).betterT3Device,
    ).toEqual({
      version: 1,
      initialization: "clean-install",
      flags: {
        "agent.fetch": false,
        "chat.classicSidebar": false,
        "agent.planMode": true,
      },
    });
  });

  it.each(MOBILE_BETTER_T3_MIRROR_CASES)(
    "repairs %s legacy writes into the %s V1 flag",
    (legacyKey, featureId) => {
      const current = finalizeMobilePreferencesMigration({}, "clean-install");
      const next = mergeMobilePreferencesPatch(current, { [legacyKey]: true });

      expect(next[legacyKey]).toBe(true);
      expect(next.betterT3Device.flags[featureId]).toBe(true);
    },
  );

  it.each(MOBILE_BETTER_T3_MIRROR_CASES)(
    "mirrors explicit %s V1 writes back to %s for older bundles",
    (legacyKey, featureId) => {
      const current = finalizeMobilePreferencesMigration({}, "clean-install");
      const next = mergeMobilePreferencesPatch(current, {
        betterT3Device: {
          ...current.betterT3Device,
          flags: { ...current.betterT3Device.flags, [featureId]: true },
        },
      });

      expect(next.betterT3Device.flags[featureId]).toBe(true);
      expect(next[legacyKey]).toBe(true);
    },
  );

  it.each(MOBILE_BETTER_T3_MIRROR_CASES)(
    "lets an explicit Mobile V1 flag win over a conflicting %s value for %s",
    (legacyKey, featureId) => {
      const current = finalizeMobilePreferencesMigration({}, "clean-install");
      const next = mergeMobilePreferencesPatch(current, {
        [legacyKey]: true,
        betterT3Device: {
          ...current.betterT3Device,
          flags: { [featureId]: false },
        },
      });

      expect(next[legacyKey]).toBe(false);
      expect(next.betterT3Device.flags[featureId]).toBe(false);
    },
  );

  it("keeps sequential Classic writes consistent for Mobile's actual layout consumer", () => {
    const current = finalizeMobilePreferencesMigration({}, "clean-install");
    const oldPageWrite = mergeMobilePreferencesPatch(current, {
      legacyThreadListEnabled: true,
    });
    expect(resolveMobileThreadListLayout(oldPageWrite.legacyThreadListEnabled)).toBe("classic");
    expect(oldPageWrite.betterT3Device.flags["chat.classicSidebar"]).toBe(true);

    const newPageWrite = mergeMobilePreferencesPatch(oldPageWrite, {
      betterT3Device: {
        ...oldPageWrite.betterT3Device,
        flags: { ...oldPageWrite.betterT3Device.flags, "chat.classicSidebar": false },
      },
    });
    expect(resolveMobileThreadListLayout(newPageWrite.legacyThreadListEnabled)).toBe("current");
    expect(newPageWrite.betterT3Device.flags["chat.classicSidebar"]).toBe(false);

    const mixedVersionWrite = mergeMobilePreferencesPatch(newPageWrite, {
      legacyThreadListEnabled: true,
      betterT3Device: {
        ...newPageWrite.betterT3Device,
        flags: { ...newPageWrite.betterT3Device.flags, "chat.classicSidebar": false },
      },
    });
    expect(resolveMobileThreadListLayout(mixedVersionWrite.legacyThreadListEnabled)).toBe(
      "current",
    );
    expect(mixedVersionWrite.betterT3Device.flags["chat.classicSidebar"]).toBe(false);

    const oldPageWriteAgain = mergeMobilePreferencesPatch(mixedVersionWrite, {
      legacyThreadListEnabled: true,
    });
    expect(resolveMobileThreadListLayout(oldPageWriteAgain.legacyThreadListEnabled)).toBe(
      "classic",
    );
    expect(oldPageWriteAgain.betterT3Device.flags["chat.classicSidebar"]).toBe(true);
  });

  it.effect("applies the mirror repair through sequential savePatch calls", () => {
    const dependencies = makeMemoryPreferenceDependencies();
    return Effect.gen(function* () {
      const store = yield* make();
      const oldPageWrite = yield* store.savePatch({ legacyThreadListEnabled: true });
      expect(resolveMobileThreadListLayout(oldPageWrite.legacyThreadListEnabled)).toBe("classic");
      expect(oldPageWrite.betterT3Device?.flags["chat.classicSidebar"]).toBe(true);

      const newPageWrite = yield* store.savePatch({
        betterT3Device: {
          ...oldPageWrite.betterT3Device!,
          flags: {
            ...oldPageWrite.betterT3Device?.flags,
            "chat.classicSidebar": false,
          },
        },
      });
      expect(resolveMobileThreadListLayout(newPageWrite.legacyThreadListEnabled)).toBe("current");
      expect(newPageWrite.betterT3Device?.flags["chat.classicSidebar"]).toBe(false);
    }).pipe(
      Effect.provideService(MobileDatabase, dependencies.database),
      Effect.provideService(MobileSecureStorage, dependencies.secureStorage),
    );
  });

  it("persists the versioned French locale record while keeping the legacy mirror", () => {
    expect(
      sanitizeMobilePreferences({
        interfaceLocaleSyncRecordV1: {
          version: 1,
          preference: "fr",
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:locale-fr",
        },
        interfaceLanguageSyncRecord: {
          preference: "de",
          updatedAt: 1_787_178_300_000,
          updateId: "mobile-device:legacy-de",
        },
      }),
    ).toEqual({
      interfaceLocaleSyncRecordV1: {
        version: 1,
        preference: "fr",
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:locale-fr",
      },
      interfaceLanguageSyncRecord: {
        preference: "de",
        updatedAt: 1_787_178_300_000,
        updateId: "mobile-device:legacy-de",
      },
    });
  });

  it("deduplicates valid instance-scoped model favorites and drops malformed entries", () => {
    expect(
      sanitizeMobilePreferences({
        modelFavorites: [
          { provider: "openrouter", model: "openai/gpt-5.5" },
          { provider: "openrouter", model: "openai/gpt-5.5" },
          { provider: "openrouter_work", model: "anthropic/claude-sonnet" },
          { provider: "", model: "bad" },
          { provider: "openrouter", model: "" },
        ],
      }),
    ).toEqual({
      modelFavorites: [
        { provider: "openrouter", model: "openai/gpt-5.5" },
        { provider: "openrouter_work", model: "anthropic/claude-sonnet" },
      ],
    });
  });

  it("persists the device-local agent workflow preferences", () => {
    expect(
      sanitizeMobilePreferences({
        experimentalFetch: true,
        experimentalParallelPlanImplementation: true,
        improvePromptBeforeSend: true,
        voiceInputOutputLanguage: "english",
        olderProjectsExpanded: true,
      }),
    ).toEqual({
      experimentalFetch: true,
      experimentalParallelPlanImplementation: true,
      improvePromptBeforeSend: true,
      voiceInputOutputLanguage: "english",
      olderProjectsExpanded: true,
    });
  });

  it("persists valid Better T3 sorting and settling controls", () => {
    expect(
      sanitizeMobilePreferences({
        sidebarProjectSortOrder: "created_at",
        sidebarThreadSortOrder: "updated_at",
        sidebarAutoSettleAfterDays: null,
        sidebarAutoSettleOnMerge: false,
      }),
    ).toEqual({
      sidebarProjectSortOrder: "created_at",
      sidebarThreadSortOrder: "updated_at",
      sidebarAutoSettleAfterDays: null,
      sidebarAutoSettleOnMerge: false,
    });
  });

  it("drops malformed Better T3 sorting and settling controls", () => {
    expect(
      sanitizeMobilePreferences({
        sidebarProjectSortOrder: "manual",
        sidebarThreadSortOrder: "manual",
        sidebarAutoSettleAfterDays: 0,
        sidebarAutoSettleOnMerge: "yes",
      } as never),
    ).toEqual({});
    expect(
      sanitizeMobilePreferences({
        sidebarAutoSettleAfterDays: 90,
      }),
    ).toEqual({ sidebarAutoSettleAfterDays: 90 });
  });

  it("resolves Better T3 settling values before the legacy merge mirror", () => {
    expect(resolveMobileSidebarSettlingPreferences(undefined)).toEqual({
      afterDays: 3,
      onMerge: true,
    });
    expect(resolveMobileSidebarSettlingPreferences({ autoSettleOnMerge: false })).toEqual({
      afterDays: 3,
      onMerge: false,
    });
    expect(
      resolveMobileSidebarSettlingPreferences({
        autoSettleOnMerge: true,
        sidebarAutoSettleAfterDays: null,
        sidebarAutoSettleOnMerge: false,
      }),
    ).toEqual({ afterDays: null, onMerge: false });
  });

  it("drops malformed workflow preferences from untrusted storage", () => {
    expect(
      sanitizeMobilePreferences({
        experimentalFetch: "yes",
        experimentalParallelPlanImplementation: "yes",
        improvePromptBeforeSend: 1,
        voiceInputOutputLanguage: "german",
        olderProjectsExpanded: "yes",
      } as unknown as {
        experimentalFetch: boolean;
        experimentalParallelPlanImplementation: boolean;
        improvePromptBeforeSend: boolean;
        voiceInputOutputLanguage: "native" | "english";
        olderProjectsExpanded: boolean;
      }),
    ).toEqual({});
  });

  it("keeps a valid project thread preview sync record and migration marker", () => {
    expect(
      sanitizeMobilePreferences({
        projectThreadPreviewSyncRecord: {
          count: 6,
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:preview-6",
        },
        projectThreadPreviewMigrationVersion: 1,
      }),
    ).toEqual({
      projectThreadPreviewSyncRecord: {
        count: 6,
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:preview-6",
      },
      projectThreadPreviewMigrationVersion: 1,
    });
  });

  it.each([
    { count: 0, updatedAt: 1_787_178_400_000, updateId: "too-small" },
    { count: 16, updatedAt: 1_787_178_400_000, updateId: "too-large" },
    { count: 3, updatedAt: -1, updateId: "negative-time" },
    { count: 3, updatedAt: 1.5, updateId: "fractional-time" },
    { count: 3, updatedAt: 1_787_178_400_000, updateId: "   " },
  ])("drops an invalid cached project thread preview record: %o", (record) => {
    expect(
      sanitizeMobilePreferences({
        projectThreadPreviewSyncRecord: record,
        projectThreadPreviewMigrationVersion: 1,
      } as never),
    ).toEqual({ projectThreadPreviewMigrationVersion: 1 });
  });

  it("drops unsupported project thread preview migration markers", () => {
    expect(
      sanitizeMobilePreferences({
        projectThreadPreviewMigrationVersion: 2,
      } as never),
    ).toEqual({});
  });

  it("keeps a valid chat visual mode sync record", () => {
    expect(
      sanitizeMobilePreferences({
        chatVisualModeSyncRecord: {
          mode: "classic",
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:chat-visuals-classic",
        },
      }),
    ).toEqual({
      chatVisualModeSyncRecord: {
        mode: "classic",
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:chat-visuals-classic",
      },
    });
  });

  it.each([
    { mode: "legacy", updatedAt: 1_787_178_400_000, updateId: "invalid-mode" },
    { mode: "current", updatedAt: -1, updateId: "negative-time" },
    { mode: "classic", updatedAt: 1.5, updateId: "fractional-time" },
    { mode: "current", updatedAt: 1_787_178_400_000, updateId: "   " },
  ])("drops an invalid cached chat visual mode record: %o", (record) => {
    expect(
      sanitizeMobilePreferences({
        chatVisualModeSyncRecord: record,
      } as never),
    ).toEqual({});
  });

  it("keeps a valid interface language sync record", () => {
    expect(
      sanitizeMobilePreferences({
        interfaceLanguageSyncRecord: {
          preference: "de",
          updatedAt: 1_787_178_400_000,
          updateId: "mobile-device:language-de",
        },
      }),
    ).toEqual({
      interfaceLanguageSyncRecord: {
        preference: "de",
        updatedAt: 1_787_178_400_000,
        updateId: "mobile-device:language-de",
      },
    });
  });

  it.each([
    { preference: "fr", updatedAt: 1_787_178_400_000, updateId: "invalid-language" },
    { preference: "system", updatedAt: -1, updateId: "negative-time" },
    { preference: "de", updatedAt: 1.5, updateId: "fractional-time" },
    { preference: "en", updatedAt: 1_787_178_400_000, updateId: "   " },
  ])("drops an invalid cached interface language record: %o", (record) => {
    expect(
      sanitizeMobilePreferences({
        interfaceLanguageSyncRecord: record,
      } as never),
    ).toEqual({});
  });
});
