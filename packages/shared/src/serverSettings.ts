import {
  isProviderDriverKind,
  isProviderAvailable,
  resolveProviderInstanceEnabled,
  type ModelSelection,
  type ProjectId,
  type ProviderDriverKind,
  type ProviderInstanceId,
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

export function resolveProjectAgentBrowserAccess(
  settings: Pick<ServerSettings, "enableAgentBrowserAccess" | "projectAgentBrowserAccessOverrides">,
  projectId: ProjectId,
): boolean {
  return (
    settings.projectAgentBrowserAccessOverrides[projectId] ?? settings.enableAgentBrowserAccess
  );
}

export function resolveProjectAutoPull(
  settings: Pick<ServerSettings, "defaultAutoPull" | "projectAutoPullOverrides">,
  projectId: ProjectId,
  legacyAutoPull: boolean | undefined,
): boolean {
  // Existing opt-ins stay enabled until explicitly overridden or reset.
  return (
    settings.projectAutoPullOverrides[projectId] ??
    (legacyAutoPull === true || settings.defaultAutoPull)
  );
}

type LegacyProviderSettings = ServerSettings["providers"][keyof ServerSettings["providers"]];

const getLegacyProviderSettings = (
  settings: ServerSettings,
  provider: ProviderDriverKind,
): LegacyProviderSettings | undefined =>
  (settings.providers as Record<string, LegacyProviderSettings | undefined>)[provider];

export function isProviderInstanceEnabled(settings: ServerSettings, instanceId: string): boolean {
  const instanceConfig = Object.hasOwn(settings.providerInstances, instanceId)
    ? settings.providerInstances[instanceId as ProviderInstanceId]
    : undefined;
  if (instanceConfig !== undefined) {
    return resolveProviderInstanceEnabled(instanceConfig);
  }

  return (
    isProviderDriverKind(instanceId) &&
    getLegacyProviderSettings(settings, instanceId)?.enabled === true
  );
}

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  return isProviderInstanceEnabled(settings, selection.instanceId);
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

function normalizePersistedServerSettingString(
  value: string | null | undefined,
): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

function extractPersistedServerObservabilitySettings(input: {
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

/** Upsert each patched entry; `null` removes it. Entries the patch omits are untouched. */
function mergeSettingsEntries<Value>(
  current: Readonly<Record<string, Value>>,
  patch: Readonly<Record<string, Value | null>>,
): Record<string, Value> {
  const next = new Map(Object.entries(current));
  for (const [id, config] of Object.entries(patch)) {
    if (config === null) {
      next.delete(id);
    } else {
      next.set(id, config);
    }
  }
  return Object.fromEntries(next);
}

type LegacyLocaleRecord = ServerSettings["interfaceLanguageSyncRecord"];
type LocaleRecordV1 = ServerSettings["interfaceLocaleSyncRecordV1"];

function localeRecordIsNewer(
  candidate: { readonly updatedAt: number; readonly updateId: string },
  current: { readonly updatedAt: number; readonly updateId: string } | undefined,
): boolean {
  if (current === undefined) return true;
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return candidate.updateId > current.updateId;
}

function resolveInterfaceLocalePatch(
  current: ServerSettings,
  patch: {
    readonly interfaceLanguageSyncRecord: LegacyLocaleRecord;
    readonly interfaceLocaleSyncRecordV1: LocaleRecordV1;
  },
): Partial<Pick<ServerSettings, "interfaceLanguageSyncRecord" | "interfaceLocaleSyncRecordV1">> {
  if (patch.interfaceLocaleSyncRecordV1 !== undefined) {
    const nextV1 = patch.interfaceLocaleSyncRecordV1;
    if (!localeRecordIsNewer(nextV1, current.interfaceLocaleSyncRecordV1)) {
      return {
        ...(current.interfaceLanguageSyncRecord === undefined
          ? {}
          : { interfaceLanguageSyncRecord: current.interfaceLanguageSyncRecord }),
        ...(current.interfaceLocaleSyncRecordV1 === undefined
          ? {}
          : { interfaceLocaleSyncRecordV1: current.interfaceLocaleSyncRecordV1 }),
      };
    }
    if (nextV1.preference === "fr") {
      return {
        ...(current.interfaceLanguageSyncRecord === undefined
          ? {}
          : { interfaceLanguageSyncRecord: current.interfaceLanguageSyncRecord }),
        interfaceLocaleSyncRecordV1: nextV1,
      };
    }
    return {
      interfaceLanguageSyncRecord: {
        preference: nextV1.preference,
        updatedAt: nextV1.updatedAt,
        updateId: nextV1.updateId,
      },
      interfaceLocaleSyncRecordV1: nextV1,
    };
  }

  const legacy = patch.interfaceLanguageSyncRecord;
  if (legacy === undefined) {
    return {
      ...(current.interfaceLanguageSyncRecord === undefined
        ? {}
        : { interfaceLanguageSyncRecord: current.interfaceLanguageSyncRecord }),
      ...(current.interfaceLocaleSyncRecordV1 === undefined
        ? {}
        : { interfaceLocaleSyncRecordV1: current.interfaceLocaleSyncRecordV1 }),
    };
  }
  const nextLegacy = localeRecordIsNewer(legacy, current.interfaceLanguageSyncRecord)
    ? legacy
    : current.interfaceLanguageSyncRecord;
  const nextV1 = localeRecordIsNewer(legacy, current.interfaceLocaleSyncRecordV1)
    ? { version: 1 as const, ...legacy }
    : current.interfaceLocaleSyncRecordV1;
  return {
    ...(nextLegacy === undefined ? {} : { interfaceLanguageSyncRecord: nextLegacy }),
    ...(nextV1 === undefined ? {} : { interfaceLocaleSyncRecordV1: nextV1 }),
  };
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings {
  const textGenerationSelectionPatch = patch.textGenerationModelSelection;
  const fetchModelSelectionPatch = patch.fetchModelSelection;
  const voiceTranslationSelectionPatch = patch.voiceTranslationModelSelection;
  const knowledgeGraphSelectionPatch = patch.knowledgeGraphModelSelection;
  const parallelPlanReviewSelectionPatch = patch.parallelPlanReviewModelSelection;
  const deepThinkingCompatibilityValue =
    patch.betterT3Environment?.flags?.["agent.deepThinking"] ??
    patch.agentEnhancement?.deepThinking?.enabled;
  const {
    betterT3Environment,
    enableAssistantStreaming,
    interfaceLanguageSyncRecord,
    interfaceLocaleSyncRecordV1,
    automaticGitFetchInterval,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    // Merged per entry below; its `null` removals must not reach deepMerge.
    usageLimitSources: usageLimitSourcesPatch,
    usagePriceOverrides: usagePriceOverridesPatch,
    projectAgentBrowserAccessOverrides: projectAgentBrowserAccessOverridesPatch,
    projectAutoPullOverrides: projectAutoPullOverridesPatch,
    textGenerationModelSelection: _textGenerationModelSelection,
    fetchModelSelection: _fetchModelSelection,
    voiceTranslationModelSelection: _voiceTranslationModelSelection,
    knowledgeGraphModelSelection: _knowledgeGraphModelSelection,
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
  const next = deepMerge(current, {
    ...patchForMerge,
    ...(enableAssistantStreaming !== undefined && patch.enableLegacyTokenStreaming === undefined
      ? { enableLegacyTokenStreaming: enableAssistantStreaming }
      : {}),
  });
  const nextWithReplacementsBase = {
    ...next,
    ...(betterT3Environment !== undefined || deepThinkingCompatibilityValue !== undefined
      ? {
          betterT3Environment: {
            ...current.betterT3Environment,
            flags: {
              ...current.betterT3Environment.flags,
              ...betterT3Environment?.flags,
              ...(deepThinkingCompatibilityValue === undefined
                ? {}
                : { "agent.deepThinking": deepThinkingCompatibilityValue }),
            },
          },
        }
      : {}),
    ...(deepThinkingCompatibilityValue === undefined
      ? {}
      : {
          agentEnhancement: {
            ...next.agentEnhancement,
            deepThinking: {
              ...next.agentEnhancement.deepThinking,
              enabled: deepThinkingCompatibilityValue,
            },
          },
        }),
    ...resolveInterfaceLocalePatch(current, {
      interfaceLanguageSyncRecord,
      interfaceLocaleSyncRecordV1,
    }),
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
    ...(projectAgentBrowserAccessOverridesPatch !== undefined
      ? {
          projectAgentBrowserAccessOverrides: mergeSettingsEntries(
            current.projectAgentBrowserAccessOverrides,
            projectAgentBrowserAccessOverridesPatch,
          ),
        }
      : {}),
    ...(projectAutoPullOverridesPatch !== undefined
      ? {
          projectAutoPullOverrides: mergeSettingsEntries(
            current.projectAutoPullOverrides,
            projectAutoPullOverridesPatch,
          ),
        }
      : {}),
    ...(patch.defaultModelSelection !== undefined
      ? { defaultModelSelection: patch.defaultModelSelection }
      : {}),
    ...(patch.defaultProjectScripts !== undefined
      ? { defaultProjectScripts: patch.defaultProjectScripts }
      : {}),
    ...(patch.projectScriptOverrides !== undefined
      ? {
          projectScriptOverrides: {
            ...current.projectScriptOverrides,
            ...patch.projectScriptOverrides,
          },
        }
      : {}),
    ...(usageLimitSourcesPatch !== undefined
      ? {
          usageLimitSources: mergeSettingsEntries(
            current.usageLimitSources,
            usageLimitSourcesPatch,
          ),
        }
      : {}),
    ...(usagePriceOverridesPatch !== undefined
      ? {
          usagePriceOverrides: mergeSettingsEntries(
            current.usagePriceOverrides,
            usagePriceOverridesPatch,
          ),
        }
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
    ...(knowledgeGraphSelectionPatch !== undefined
      ? { knowledgeGraphModelSelection: knowledgeGraphSelectionPatch }
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
