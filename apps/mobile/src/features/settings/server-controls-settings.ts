import type {
  BackgroundActivityProfile,
  BackgroundActivitySettings,
  BackgroundActivityOverrides,
  ServerSettings,
  ServerSettingsPatch,
  SourceControlWritingStyleSettings,
  WorktreeCleanupRules,
} from "@t3tools/contracts";
import {
  normalizeServerBackgroundActivitySettings,
  resolveServerBackgroundActivitySettings,
} from "@t3tools/shared/backgroundActivitySettings";
import { resolveWorktreeCleanup } from "@t3tools/shared/projectSettings";

import {
  planMobileScopedSettingsPatch,
  type ScopedMobileSettingsTarget,
} from "./settings-scoped-server";

/** A style field's value when every target agrees on it, otherwise null. */
export function uniformWritingStyleField<K extends keyof SourceControlWritingStyleSettings>(
  targets: readonly Pick<ScopedMobileSettingsTarget, "settings">[],
  key: K,
): SourceControlWritingStyleSettings[K] | null {
  const reference = targets[0]?.settings.sourceControlWritingStyle[key];
  if (reference === undefined) return null;
  return targets.every((target) => target.settings.sourceControlWritingStyle[key] === reference)
    ? reference
    : null;
}

/**
 * An environment keeps the style fields a patch leaves out. A project override replaces the
 * whole style, so there the unchanged fields are sent too, from the first target when they differ.
 */
export function buildWritingStylePatch(
  targets: readonly Pick<ScopedMobileSettingsTarget, "settings">[],
  projectSelected: boolean,
  change: Partial<SourceControlWritingStyleSettings>,
): ServerSettingsPatch {
  const reference = targets[0]?.settings.sourceControlWritingStyle;
  return {
    sourceControlWritingStyle: projectSelected && reference ? { ...reference, ...change } : change,
  };
}

/** The shared policy every target agrees on, or null when they differ. */
export function uniformBackgroundActivityProfile(
  targets: readonly Pick<ScopedMobileSettingsTarget, "settings">[],
): BackgroundActivityProfile | null {
  const profiles = targets.map(
    (target) => resolveServerBackgroundActivitySettings(target.settings).profile,
  );
  const [first] = profiles;
  return first !== undefined && profiles.every((profile) => profile === first) ? first : null;
}

/** Changes the shared policy and keeps the interval and pause overrides the server already has. */
export function buildBackgroundActivityProfilePatch(
  settings: ServerSettings,
  profile: BackgroundActivityProfile,
): { readonly backgroundActivity: BackgroundActivitySettings } {
  const normalized = normalizeServerBackgroundActivitySettings(settings);
  return {
    backgroundActivity: {
      schemaVersion: 1,
      profile: "custom",
      baseProfile: profile,
      overrides: normalized.profile === "custom" ? normalized.overrides : {},
    },
  };
}

export function buildBackgroundActivityOverridePatch(
  settings: ServerSettings,
  change: BackgroundActivityOverrides,
): ServerSettingsPatch {
  const normalized = normalizeServerBackgroundActivitySettings(settings);
  return {
    backgroundActivity: {
      schemaVersion: 1,
      profile: "custom",
      baseProfile: resolveServerBackgroundActivitySettings(settings).profile,
      overrides: { ...(normalized.profile === "custom" ? normalized.overrides : {}), ...change },
    },
  };
}

export function buildWorktreeCleanupPatch(
  settings: ServerSettings,
  projectSelected: boolean,
  change: Partial<WorktreeCleanupRules>,
): ServerSettingsPatch {
  if (projectSelected || settings.worktreeCleanup?.mode === "custom") {
    return {
      worktreeCleanup: {
        mode: "custom",
        rules: { ...resolveWorktreeCleanup(settings, null), ...change },
      },
    };
  }
  return { storageCleanup: change };
}

export function parseSettingsInteger(
  text: string,
  minimum: number,
  maximum: number,
  nullable = false,
): number | null | undefined {
  const value = text.trim();
  if (nullable && value === "") return null;
  if (!/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

export function planMobileScopedSettingsTransform(
  targets: readonly ScopedMobileSettingsTarget[],
  projectSelected: boolean,
  build: (settings: ServerSettings) => ServerSettingsPatch,
) {
  return targets.flatMap((target) =>
    planMobileScopedSettingsPatch([target], projectSelected, build(target.settings)),
  );
}
