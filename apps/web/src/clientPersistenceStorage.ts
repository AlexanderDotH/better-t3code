import {
  bootstrapBetterT3SettingsV1,
  ClientSettingsSchema,
  DEFAULT_CLIENT_SETTINGS,
  type BetterT3CompatibilityFlagV1,
  type BetterT3SwitchFeatureId,
  type ClientSettings,
} from "@t3tools/contracts";

import { getLocalStorageItem, setLocalStorageItem } from "./hooks/useLocalStorage";

export const CLIENT_SETTINGS_STORAGE_KEY = "t3code:client-settings:v1";

const LEGACY_BETTER_T3_CLIENT_MIRRORS = [
  ["experimentalFetch", "agent.fetch"],
  ["experimentalParallelPlanImplementation", "agent.parallelPlanImplementation"],
  ["planModeEnabled", "agent.planMode"],
  ["improvePromptBeforeSend", "agent.promptImprovement"],
  ["showExpandedComposerControls", "agent.expandedComposerControls"],
  ["showReasoning", "agent.reasoningVisibility"],
  ["legacySidebarEnabled", "chat.classicSidebar"],
] as const satisfies ReadonlyArray<readonly [keyof ClientSettings, BetterT3SwitchFeatureId]>;

function hasWindow(): boolean {
  return typeof window !== "undefined";
}

function recordFromUnknown(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Readonly<Record<string, unknown>>;
}

function compatibilityFlags(
  document: Readonly<Record<string, unknown>>,
  settings: ClientSettings,
): ReadonlyArray<BetterT3CompatibilityFlagV1> {
  return LEGACY_BETTER_T3_CLIENT_MIRRORS.flatMap(([key, featureId]) => {
    const enabled = settings[key];
    const differsFromCleanDefault = enabled !== DEFAULT_CLIENT_SETTINGS[key];
    const preservesExistingBehavior =
      settings.betterT3Device.initialization === "existing-install-migration";
    return Object.hasOwn(document, key) &&
      typeof enabled === "boolean" &&
      (preservesExistingBehavior || differsFromCleanDefault)
      ? [{ featureId, enabled }]
      : [];
  });
}

export function readBrowserClientSettings(): ClientSettings | null {
  if (!hasWindow()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(CLIENT_SETTINGS_STORAGE_KEY);
    const settings = getLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, ClientSettingsSchema);
    if (raw === null || settings === null) return settings;
    const document = recordFromUnknown(JSON.parse(raw));
    if (document === null) return settings;
    const hasBetterT3Settings = Object.hasOwn(document, "betterT3Device");
    return {
      ...settings,
      betterT3Device: bootstrapBetterT3SettingsV1({
        version: 1,
        initialization: "existing-install-migration",
        persistedSettings: hasBetterT3Settings ? settings.betterT3Device : null,
        compatibilityFlags: compatibilityFlags(document, settings),
      }),
    };
  } catch (error) {
    console.error("Could not read persisted client settings.", error);
    return null;
  }
}

export function writeBrowserClientSettings(settings: ClientSettings): void {
  if (!hasWindow()) {
    return;
  }

  setLocalStorageItem(CLIENT_SETTINGS_STORAGE_KEY, settings, ClientSettingsSchema);
}
