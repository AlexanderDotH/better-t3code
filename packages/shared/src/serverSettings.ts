import {
  isProviderDriverKind,
  isProviderAvailable,
  type ModelSelection,
  type ProviderDriverKind,
  type ServerProvider,
  ServerSettings,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection } from "./model.ts";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];

const getLegacyProviderSettings = (
  settings: ServerSettings,
  provider: ProviderDriverKind,
): LegacyProviderSettings | undefined =>
  (settings.providers as Record<string, LegacyProviderSettings | undefined>)[provider];

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  const instanceConfig = settings.providerInstances[selection.instanceId];
  if (instanceConfig !== undefined) {
    return instanceConfig.enabled ?? true;
  }

  return (
    isProviderDriverKind(selection.instanceId) &&
    getLegacyProviderSettings(settings, selection.instanceId)?.enabled === true
  );
}

function resolveTextGenerationModelOverride(
  settings: ServerSettings,
  selection: ModelSelection | null,
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection {
  if (!selection || !isModelSelectionProviderEnabled(settings, selection)) {
    return settings.textGenerationModelSelection;
  }
  if (providers === undefined) {
    return selection;
  }

  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return provider?.enabled === true && isProviderAvailable(provider)
    ? selection
    : settings.textGenerationModelSelection;
}

export function resolveSourceControlWriterModelSelection(
  settings: ServerSettings,
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection {
  return resolveTextGenerationModelOverride(
    settings,
    settings.sourceControlWriterModelSelection,
    providers,
  );
}

export function resolveVoiceTranslationModelSelection(
  settings: ServerSettings,
  providers?: ReadonlyArray<ServerProvider>,
): ModelSelection {
  return resolveTextGenerationModelOverride(
    settings,
    settings.voiceTranslationModelSelection,
    providers,
  );
}

export interface PersistedServerObservabilitySettings {
  readonly otlpTracesUrl: string | undefined;
  readonly otlpMetricsUrl: string | undefined;
}

export function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

export function extractPersistedServerObservabilitySettings(input: {
  readonly observability?: {
    readonly otlpTracesUrl?: string;
    readonly otlpMetricsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined };
}

type ModelSelectionPatch = NonNullable<ServerSettingsPatch["textGenerationModelSelection"]>;

function shouldReplaceModelSelection(patch: ModelSelectionPatch | undefined): boolean {
  return Boolean(patch && (patch.instanceId !== undefined || patch.model !== undefined));
}

function applyModelSelectionPatch(
  current: ModelSelection,
  patch: ModelSelectionPatch,
): ModelSelection {
  const instanceId = patch.instanceId ?? current.instanceId;
  const model = patch.model ?? current.model;
  const options = shouldReplaceModelSelection(patch)
    ? patch.options
    : mergeModelSelectionOptionsById({ current: current.options, patch: patch.options });
  return createModelSelection(instanceId, model, options);
}

function mergeModelSelectionOptionsById(input: {
  current: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
  patch: ReadonlyArray<{ readonly id: string; readonly value: string | boolean }> | undefined;
}): Array<{ id: string; value: string | boolean }> | undefined {
  if (input.patch === undefined) {
    return input.current ? [...input.current] : undefined;
  }
  if (input.patch.length === 0) {
    return undefined;
  }

  const merged = new Map((input.current ?? []).map((selection) => [selection.id, selection.value]));
  for (const selection of input.patch) {
    merged.set(selection.id, selection.value);
  }
  return [...merged.entries()].map(([id, value]) => ({ id, value }));
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const textGenerationSelectionPatch = patch.textGenerationModelSelection;
  const fetchModelSelectionPatch = patch.fetchModelSelection;
  const voiceTranslationSelectionPatch = patch.voiceTranslationModelSelection;
  const parallelPlanReviewSelectionPatch = patch.parallelPlanReviewModelSelection;
  const {
    automaticGitFetchInterval,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    textGenerationModelSelection: _textGenerationModelSelection,
    fetchModelSelection: _fetchModelSelection,
    voiceTranslationModelSelection: _voiceTranslationModelSelection,
    parallelPlanReviewModelSelection: _parallelPlanReviewModelSelection,
    ...patchForMerge
  } = patch;
  const currentBackgroundActivity = normalizeServerBackgroundActivitySettings(current);
  const backgroundActivityPatch =
    backgroundActivityProfile !== undefined
      ? {
          schemaVersion: 1 as const,
          profile:
            automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
              ? ("custom" as const)
              : backgroundActivityProfile,
          ...(automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
            ? { baseProfile: backgroundActivityProfile }
            : {}),
          overrides: {
            ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
            ...(providerHealthRefreshInterval !== undefined
              ? { providerHealthRefreshInterval }
              : {}),
          },
        }
      : automaticGitFetchInterval !== undefined || providerHealthRefreshInterval !== undefined
        ? {
            schemaVersion: 1 as const,
            profile: "custom" as const,
            baseProfile: getBackgroundActivityBaseProfile(currentBackgroundActivity),
            overrides: {
              ...(currentBackgroundActivity.profile === "custom"
                ? currentBackgroundActivity.overrides
                : {}),
              ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
              ...(providerHealthRefreshInterval !== undefined
                ? { providerHealthRefreshInterval }
                : {}),
            },
          }
        : undefined;
  const next = deepMerge(current, patchForMerge);
  const nextWithReplacementsBase = {
    ...next,
    ...(backgroundActivity !== undefined
      ? {
          backgroundActivity: {
            ...deepMerge(currentBackgroundActivity, backgroundActivity),
            ...(backgroundActivity.overrides !== undefined
              ? { overrides: backgroundActivity.overrides }
              : {}),
          },
        }
      : { backgroundActivity: currentBackgroundActivity }),
    ...(backgroundActivity === undefined && backgroundActivityPatch !== undefined
      ? { backgroundActivity: backgroundActivityPatch }
      : {}),
    ...(patch.providerInstances !== undefined
      ? { providerInstances: patch.providerInstances }
      : {}),
    ...(patch.sourceControlWriterModelSelection !== undefined
      ? { sourceControlWriterModelSelection: patch.sourceControlWriterModelSelection }
      : {}),
    ...(fetchModelSelectionPatch !== undefined
      ? { fetchModelSelection: fetchModelSelectionPatch }
      : {}),
    ...(voiceTranslationSelectionPatch !== undefined
      ? { voiceTranslationModelSelection: voiceTranslationSelectionPatch }
      : {}),
    ...(patch.mcp?.servers !== undefined
      ? { mcp: { ...next.mcp, servers: patch.mcp.servers } }
      : {}),
    ...(patch.skills?.disabledSkillIds !== undefined
      ? { skills: { ...next.skills, disabledSkillIds: patch.skills.disabledSkillIds } }
      : {}),
    ...(automaticGitFetchInterval !== undefined ? { automaticGitFetchInterval } : {}),
    ...(providerHealthRefreshInterval !== undefined ? { providerHealthRefreshInterval } : {}),
  };
  const normalizedBackgroundActivity = normalizeBackgroundActivitySettings(
    nextWithReplacementsBase.backgroundActivity,
  );
  const resolvedBackgroundActivity = resolveBackgroundActivitySettings(
    normalizedBackgroundActivity,
  );
  const nextWithReplacements = {
    ...nextWithReplacementsBase,
    backgroundActivity: normalizedBackgroundActivity,
    automaticGitFetchInterval: resolvedBackgroundActivity.automaticGitFetchInterval,
    providerHealthRefreshInterval: resolvedBackgroundActivity.providerHealthRefreshInterval,
    backgroundActivityProfile: resolvedBackgroundActivity.profile,
  };
  return {
    ...nextWithReplacements,
    ...(textGenerationSelectionPatch !== undefined
      ? {
          textGenerationModelSelection: applyModelSelectionPatch(
            current.textGenerationModelSelection,
            textGenerationSelectionPatch,
          ),
        }
      : {}),
    ...(parallelPlanReviewSelectionPatch !== undefined
      ? {
          parallelPlanReviewModelSelection: applyModelSelectionPatch(
            current.parallelPlanReviewModelSelection,
            parallelPlanReviewSelectionPatch,
          ),
        }
      : {}),
  };
}
