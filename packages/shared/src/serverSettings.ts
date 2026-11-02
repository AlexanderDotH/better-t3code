import type { ModelPreferences } from "@t3tools/contracts/settings";
import {
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_TEXT_GENERATION_MODEL,
  DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER,
  defaultInstanceIdForDriver,
  globalIdleCompaction,
  type IdleCompactionMode,
  isProviderAvailable,
  isUnconfiguredDefaultInstanceEnabled,
  resolveProjectProviderInstanceEnabled,
  resolveProviderInstanceEnabled,
  isProviderTextGenerationCapable,
  ModelSelection,
  type ProjectId,
  type ProjectScopedServerSettingKey,
  ProjectSettingsOverrides,
  ProviderDriverKind,
  ProviderInstanceId,
  chatVisualModeToLegacyRecord,
  resolveChatVisualModeRecord,
  type ProjectChatSettings,
  type ServerProvider,
  ServerSettings,
  type ServerSettingsPatch,
  withIdleCompaction,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { deepMerge } from "./Struct.ts";
import { fromLenientJson } from "./schemaJson.ts";
import { createModelSelection, readCustomModelEntries } from "./model.ts";
import {
  getBackgroundActivityBaseProfile,
  normalizeBackgroundActivitySettings,
  normalizeServerBackgroundActivitySettings,
  resolveBackgroundActivitySettings,
} from "./backgroundActivitySettings.ts";

const ServerSettingsJson = fromLenientJson(ServerSettings);
const decodeServerSettingsJson = Schema.decodeUnknownOption(ServerSettingsJson);

/** @deprecated Read `resolveProjectSettings(...).settings.enableAgentBrowserAccess`. */
export function resolveProjectAgentBrowserAccess(
  settings: Pick<
    ServerSettings,
    "enableAgentBrowserAccess" | "projectAgentBrowserAccessOverrides" | "projectSettingsOverrides"
  >,
  projectId: ProjectId,
): boolean {
  return (
    settings.projectSettingsOverrides[projectId]?.enableAgentBrowserAccess ??
    settings.projectAgentBrowserAccessOverrides[projectId] ??
    settings.enableAgentBrowserAccess
  );
}

/** @deprecated Read `resolveProjectSettings(...).settings.defaultAutoPull`. */
export function resolveProjectAutoPull(
  settings: Pick<
    ServerSettings,
    "defaultAutoPull" | "projectAutoPullOverrides" | "projectSettingsOverrides"
  >,
  projectId: ProjectId,
  legacyAutoPull: boolean | undefined,
): boolean {
  // Existing opt-ins stay enabled until explicitly overridden or reset.
  return (
    settings.projectSettingsOverrides[projectId]?.defaultAutoPull ??
    settings.projectAutoPullOverrides[projectId] ??
    (legacyAutoPull === true || settings.defaultAutoPull)
  );
}

export function isModelSelectionProviderEnabled(
  settings: ServerSettings,
  selection: ModelSelection,
): boolean {
  const instanceConfig = settings.providerInstances[selection.instanceId];
  if (instanceConfig !== undefined) {
    return resolveProviderInstanceEnabled(instanceConfig);
  }

  return isUnconfiguredDefaultInstanceEnabled(selection.instanceId);
}

const TEXT_GENERATION_FALLBACK_DRIVERS = [
  "codex",
  "claudeAgent",
  "cursor",
  "grok",
  "muse",
  "pi",
  "opencode",
  "antigravity",
].map((driver) => ProviderDriverKind.make(driver));

/** Only project-scoped callers may include configured instances when falling back; machine-level callers leave it unset. */
export function fallbackTextGenerationModelSelection(
  providerInstances: ServerSettings["providerInstances"],
  isEnabled: (instanceId: ProviderInstanceId, driver: ProviderDriverKind) => boolean,
  options?: {
    readonly includeConfiguredInstances?: boolean;
    readonly defaultModelSelection?: ModelSelection | null;
  },
): ModelSelection | null {
  const candidates = [
    ...TEXT_GENERATION_FALLBACK_DRIVERS.map(
      (driver) => [defaultInstanceIdForDriver(driver), driver] as const,
    ),
    ...(options?.includeConfiguredInstances === true
      ? Object.entries(providerInstances).flatMap(([instanceId, instance]) =>
          TEXT_GENERATION_FALLBACK_DRIVERS.includes(instance.driver)
            ? [[ProviderInstanceId.make(instanceId), instance.driver] as const]
            : [],
        )
      : []),
  ];
  const match = candidates.find(([instanceId, driver]) => isEnabled(instanceId, driver));
  if (match === undefined) return null;
  const [instanceId, driver] = match;
  const threadDefault = options?.defaultModelSelection;
  const config = providerInstances[instanceId]?.config as { customModels?: unknown } | undefined;
  if (
    threadDefault?.instanceId === instanceId &&
    readCustomModelEntries(config?.customModels).some((entry) => entry.slug === threadDefault.model)
  ) {
    return threadDefault;
  }
  return { instanceId, model: defaultTextGenerationModel(driver) };
}

export function defaultTextGenerationModel(driver: ProviderDriverKind): string {
  return (
    DEFAULT_TEXT_GENERATION_MODEL_BY_PROVIDER[driver] ??
    DEFAULT_MODEL_BY_PROVIDER[driver] ??
    DEFAULT_TEXT_GENERATION_MODEL
  );
}

export function resolveSourceControlWriterModelSelection(
  settings: ServerSettings,
  providers: ReadonlyArray<ServerProvider> | undefined,
  projectId: ProjectId | null,
): ModelSelection {
  const selection = settings.sourceControlWriterModelSelection;
  if (
    !selection ||
    !resolveProjectProviderInstanceEnabled(settings, projectId, selection.instanceId)
  ) {
    return settings.textGenerationModelSelection;
  }
  if (providers === undefined) {
    return selection;
  }

  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  return provider?.enabled === true &&
    isProviderAvailable(provider) &&
    isProviderTextGenerationCapable(provider)
    ? selection
    : settings.textGenerationModelSelection;
}

export function resolveReviewGuideModelSelection(
  settings: ServerSettings,
  providers: ReadonlyArray<ServerProvider> | undefined,
  projectId: ProjectId | null,
): ModelSelection {
  const selection = settings.reviewGuideModelSelection;
  if (
    selection &&
    resolveProjectProviderInstanceEnabled(settings, projectId, selection.instanceId)
  ) {
    const provider = providers?.find((candidate) => candidate.instanceId === selection.instanceId);
    if (
      providers === undefined ||
      (provider?.enabled === true &&
        isProviderAvailable(provider) &&
        isProviderTextGenerationCapable(provider))
    ) {
      return selection;
    }
  }
  return resolveSourceControlWriterModelSelection(settings, providers, projectId);
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
  readonly otlpLogsUrl: string | undefined;
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
    readonly otlpLogsUrl?: string;
  };
}): PersistedServerObservabilitySettings {
  return {
    otlpTracesUrl: normalizePersistedServerSettingString(input.observability?.otlpTracesUrl),
    otlpMetricsUrl: normalizePersistedServerSettingString(input.observability?.otlpMetricsUrl),
    otlpLogsUrl: normalizePersistedServerSettingString(input.observability?.otlpLogsUrl),
  };
}

export function parsePersistedServerObservabilitySettings(
  raw: string,
): PersistedServerObservabilitySettings {
  const decoded = decodeServerSettingsJson(raw);
  if (Option.isSome(decoded)) {
    return extractPersistedServerObservabilitySettings(decoded.value);
  }
  return { otlpTracesUrl: undefined, otlpMetricsUrl: undefined, otlpLogsUrl: undefined };
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

const sameProjectDefaultModel = Schema.toEquivalence(
  Schema.UndefinedOr(Schema.NullOr(ModelSelection)),
);

function applyProjectChatSettingsPatch(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): ServerSettings["projectChatSettings"] {
  if (patch.projectSettingsOverrides === undefined && patch.projectChatSettings === undefined) {
    return current.projectChatSettings;
  }
  const entries: Record<string, ProjectChatSettings> = { ...current.projectChatSettings };
  for (const [projectId, overrides] of Object.entries(patch.projectSettingsOverrides ?? {})) {
    const previous = current.projectSettingsOverrides[projectId as ProjectId];
    const resetModel = !sameProjectDefaultModel(
      previous?.defaultModelSelection,
      overrides?.defaultModelSelection,
    );
    const resetRuntime = previous?.defaultRuntimeMode !== overrides?.defaultRuntimeMode;
    if (!resetModel && !resetRuntime) continue;

    const remembered = { ...entries[projectId] };
    if (resetModel) delete remembered.modelSelection;
    if (resetRuntime) delete remembered.runtimeMode;
    // Keep an empty entry so clients do not bootstrap stale choices from old threads.
    entries[projectId] = remembered;
  }
  return patch.projectChatSettings === undefined
    ? entries
    : mergeSettingsEntries(entries, patch.projectChatSettings);
}

type LegacyLocaleRecord = ServerSettings["interfaceLanguageSyncRecord"];
type LocaleRecordV1 = ServerSettings["interfaceLocaleSyncRecordV1"];

function syncRecordIsNewer(
  candidate: { readonly updatedAt: number; readonly updateId: string },
  current: { readonly updatedAt: number; readonly updateId: string } | undefined,
): boolean {
  if (current === undefined) return true;
  if (candidate.updatedAt !== current.updatedAt) return candidate.updatedAt > current.updatedAt;
  return candidate.updateId > current.updateId;
}

function resolveChatVisualModePatch(
  current: ServerSettings,
  patch: {
    readonly chatVisualModeSyncRecord: ServerSettings["chatVisualModeSyncRecord"];
    readonly chatVisualModeSyncRecordV2: ServerSettings["chatVisualModeSyncRecordV2"];
  },
): Pick<ServerSettings, "chatVisualModeSyncRecord" | "chatVisualModeSyncRecordV2"> {
  if (
    patch.chatVisualModeSyncRecord === undefined &&
    patch.chatVisualModeSyncRecordV2 === undefined
  ) {
    return {};
  }
  const legacy =
    patch.chatVisualModeSyncRecord !== undefined &&
    syncRecordIsNewer(patch.chatVisualModeSyncRecord, current.chatVisualModeSyncRecord)
      ? patch.chatVisualModeSyncRecord
      : current.chatVisualModeSyncRecord;
  const incomingV2 = patch.chatVisualModeSyncRecordV2;
  const currentV2 = current.chatVisualModeSyncRecordV2;
  // A client may have promoted the Current mirror before learning its Better T3 source.
  const restoresBetterT3 =
    incomingV2?.mode === "better-t3" &&
    currentV2?.mode === "current" &&
    incomingV2.updatedAt === currentV2.updatedAt &&
    incomingV2.updateId === currentV2.updateId;
  const v2 =
    incomingV2 !== undefined && (syncRecordIsNewer(incomingV2, currentV2) || restoresBetterT3)
      ? incomingV2
      : currentV2;
  const record = resolveChatVisualModeRecord(legacy, v2);
  if (record === null) return {};
  return {
    chatVisualModeSyncRecord: chatVisualModeToLegacyRecord(record),
    // Keep legacy writes distinct so a later V2 record can supersede its own mirror.
    ...(v2 === undefined ? {} : { chatVisualModeSyncRecordV2: v2 }),
  };
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
    if (!syncRecordIsNewer(nextV1, current.interfaceLocaleSyncRecordV1)) {
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
  const nextLegacy = syncRecordIsNewer(legacy, current.interfaceLanguageSyncRecord)
    ? legacy
    : current.interfaceLanguageSyncRecord;
  const nextV1 = syncRecordIsNewer(legacy, current.interfaceLocaleSyncRecordV1)
    ? { version: 1 as const, ...legacy }
    : current.interfaceLocaleSyncRecordV1;
  return {
    ...(nextLegacy === undefined ? {} : { interfaceLanguageSyncRecord: nextLegacy }),
    ...(nextV1 === undefined ? {} : { interfaceLocaleSyncRecordV1: nextV1 }),
  };
}

/**
 * Derived views of `projectSettingsOverrides` for clients that still read
 * the legacy per-key maps. Recomputed on every patch and load so they
 * cannot drift from the generic record.
 */
const knownProjectOverrideKeys = new Set(Object.keys(ProjectSettingsOverrides.fields));

function pickOverrideKeys(entry: ProjectSettingsOverrides | undefined, known: boolean) {
  return Object.fromEntries(
    Object.entries<unknown>(entry ?? {}).filter(
      ([key]) => knownProjectOverrideKeys.has(key) === known,
    ),
  );
}

// Older clients omit providerInstances during whole-entry replacement; preserve it to avoid wiping overrides.
function mergeProjectSettingsOverridesPatch(
  current: Readonly<Record<string, ProjectSettingsOverrides>>,
  patch: Readonly<Record<string, ProjectSettingsOverrides | null>>,
): Record<string, ProjectSettingsOverrides> {
  const next = new Map(Object.entries(current));
  for (const [projectId, entry] of Object.entries(patch)) {
    if (entry === null) {
      next.delete(projectId);
      continue;
    }
    const storedProviderInstances = current[projectId]?.providerInstances;
    next.set(projectId, {
      // Preserve downgraded storage, but reject new unknown writes so clients can detect unsupported settings.
      ...pickOverrideKeys(current[projectId], false),
      ...pickOverrideKeys(entry, true),
      ...(Object.hasOwn(entry, "providerInstances") || storedProviderInstances === undefined
        ? {}
        : { providerInstances: storedProviderInstances }),
    });
  }
  return Object.fromEntries(next);
}

export function deriveLegacyProjectOverrides(
  settings: Pick<ServerSettings, "projectSettingsOverrides">,
): Pick<
  ServerSettings,
  "projectAgentBrowserAccessOverrides" | "projectAutoPullOverrides" | "projectScriptOverrides"
> {
  const projectAgentBrowserAccessOverrides: Record<string, boolean> = {};
  const projectAutoPullOverrides: Record<string, boolean> = {};
  const projectScriptOverrides: Record<string, ServerSettings["defaultProjectScripts"] | null> = {};
  for (const [projectId, entry] of Object.entries(settings.projectSettingsOverrides)) {
    if (entry.enableAgentBrowserAccess !== undefined) {
      projectAgentBrowserAccessOverrides[projectId] = entry.enableAgentBrowserAccess;
    }
    if (entry.defaultAutoPull !== undefined) {
      projectAutoPullOverrides[projectId] = entry.defaultAutoPull;
    }
    if (entry.defaultProjectScripts !== undefined) {
      projectScriptOverrides[projectId] = entry.defaultProjectScripts;
    }
  }
  return { projectAgentBrowserAccessOverrides, projectAutoPullOverrides, projectScriptOverrides };
}

function translateLegacyProjectOverridePatch(
  current: Pick<ServerSettings, "projectSettingsOverrides">,
  patch: ServerSettingsPatch,
): ServerSettingsPatch {
  const {
    projectAgentBrowserAccessOverrides,
    projectAutoPullOverrides,
    projectScriptOverrides,
    ...rest
  } = patch;
  if (
    projectAgentBrowserAccessOverrides === undefined &&
    projectAutoPullOverrides === undefined &&
    projectScriptOverrides === undefined
  ) {
    return patch;
  }
  const currentEntries: Readonly<Record<string, ProjectSettingsOverrides>> =
    current.projectSettingsOverrides;
  const entries = new Map<string, ProjectSettingsOverrides | null>(
    Object.entries(rest.projectSettingsOverrides ?? {}),
  );
  // Canonical entries outrank legacy maps, including deliberately omitted keys.
  const canonicalProjectIds = new Set(Object.keys(rest.projectSettingsOverrides ?? {}));
  const applyKey = <K extends ProjectScopedServerSettingKey>(
    map: Readonly<Record<string, ProjectSettingsOverrides[K] | null>> | undefined,
    key: K,
  ) => {
    if (map === undefined) return;
    for (const [projectId, value] of Object.entries(map)) {
      if (canonicalProjectIds.has(projectId)) continue;
      const entry: ProjectSettingsOverrides = {
        ...(entries.get(projectId) ?? currentEntries[projectId]),
      };
      if (value === null || value === undefined) {
        delete entry[key];
      } else {
        entry[key] = value;
      }
      entries.set(projectId, Object.keys(entry).length === 0 ? null : entry);
    }
  };
  applyKey(projectAgentBrowserAccessOverrides, "enableAgentBrowserAccess");
  applyKey(projectAutoPullOverrides, "defaultAutoPull");
  applyKey(projectScriptOverrides, "defaultProjectScripts");
  return {
    ...rest,
    projectSettingsOverrides: Object.fromEntries(entries),
  } as ServerSettingsPatch;
}

/**
 * A client from before `idleCompaction` patches the old boolean switch. Turning
 * it off keeps "Never" rather than reverting to the default.
 */
function patchedIdleCompaction(
  current: ServerSettings,
  patch: ServerSettingsPatch,
): IdleCompactionMode {
  if (patch.idleCompaction !== undefined) return patch.idleCompaction;
  const legacy = patch.compactIdleThreads;
  if (legacy === undefined) return globalIdleCompaction(current);
  if (typeof legacy === "string") return legacy;
  if (legacy) return "beforeCacheExpires";
  return globalIdleCompaction(current) === "off" ? "off" : "onReturn";
}

export function applyServerSettingsPatch(
  current: ServerSettings,
  rawPatch: ServerSettingsPatch,
): ServerSettings {
  const patch = translateLegacyProjectOverridePatch(current, rawPatch);
  const textGenerationSelectionPatch = patch.textGenerationModelSelection;
  const fetchModelSelectionPatch = patch.fetchModelSelection;
  const contextCompactionSelectionPatch = patch.contextCompactionModelSelection;
  const voiceTranslationSelectionPatch = patch.voiceTranslationModelSelection;
  const knowledgeGraphSelectionPatch = patch.knowledgeGraphModelSelection;
  const projectIndexingSelectionPatch = patch.projectIndexingDefaultModelSelection;
  const parallelPlanReviewSelectionPatch = patch.parallelPlanReviewModelSelection;
  const deepThinkingCompatibilityValue =
    patch.betterT3Environment?.flags?.["agent.deepThinking"] ??
    patch.agentEnhancement?.deepThinking?.enabled;
  const {
    betterT3Environment,
    enableAssistantStreaming,
    enableLegacyTokenStreaming,
    responseStreamingMode,
    chatVisualModeSyncRecord,
    chatVisualModeSyncRecordV2,
    interfaceLanguageSyncRecord,
    interfaceLocaleSyncRecordV1,
    migrateModelPreferences,
    setModelFavorites,
    setModelsHidden,
    setProviderModelOrder,
    providerModelPreferences,
    automaticGitFetchInterval,
    providerHealthRefreshInterval,
    backgroundActivityProfile,
    backgroundActivity,
    worktreeCleanup: worktreeCleanupPatch,
    // Merged per entry below; its `null` removals must not reach deepMerge.
    usageLimitSources: usageLimitSourcesPatch,
    secretProviders: secretProvidersPatch,
    sourceControlHosts: sourceControlHostsPatch,
    usagePriceOverrides: usagePriceOverridesPatch,
    speechTranscription: speechTranscriptionPatch,
    textGenerationModelSelection: _textGenerationModelSelection,
    fetchModelSelection: _fetchModelSelection,
    contextCompactionModelSelection: _contextCompactionModelSelection,
    voiceTranslationModelSelection: _voiceTranslationModelSelection,
    knowledgeGraphModelSelection: _knowledgeGraphModelSelection,
    projectIndexingDefaultModelSelection: _projectIndexingDefaultModelSelection,
    parallelPlanReviewModelSelection: _parallelPlanReviewModelSelection,
    // Entry replacement: deepMerge would keep keys the client meant to clear.
    projectSettingsOverrides: projectSettingsOverridesPatch,
    projectChatSettings: _projectChatSettings,
    // Already translated into `projectSettingsOverrides` above; the legacy
    // maps are derived views and must never be merged directly.
    usageModelAliases: usageModelAliasesPatch,
    projectAgentBrowserAccessOverrides: _legacyBrowserAccess,
    projectAutoPullOverrides: _legacyAutoPull,
    projectScriptOverrides: _legacyScripts,
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
  const initialFavorites =
    patch.favorites ?? current.favorites ?? migrateModelPreferences?.favorites ?? null;
  const favorites =
    setModelFavorites?.reduce(
      (current, change) => {
        const exists = current.some(
          (favorite) => favorite.provider === change.provider && favorite.model === change.model,
        );
        if (change.favorite) {
          if (!exists) current.push({ provider: change.provider, model: change.model });
          return current;
        }
        return current.filter(
          (favorite) => favorite.provider !== change.provider || favorite.model !== change.model,
        );
      },
      [...(initialFavorites ?? [])],
    ) ?? initialFavorites;
  const initialModelPreferences =
    providerModelPreferences ??
    current.providerModelPreferences ??
    migrateModelPreferences?.providerModelPreferences ??
    null;
  let nextModelPreferences = initialModelPreferences;
  if (setModelsHidden?.length) {
    const updated = { ...initialModelPreferences };
    for (const change of setModelsHidden) {
      const preferences = (Object.hasOwn(updated, change.provider)
        ? updated[change.provider]
        : undefined) ?? {
        hiddenModels: [],
        modelOrder: [],
      };
      const hiddenModels = preferences.hiddenModels.filter((model) => model !== change.model);
      if (change.hidden) hiddenModels.push(change.model);
      updated[change.provider] = { ...preferences, hiddenModels };
    }
    nextModelPreferences = updated;
  }
  if (setProviderModelOrder) {
    const preferences = nextModelPreferences?.[setProviderModelOrder.provider] ?? {
      hiddenModels: [],
      modelOrder: [],
    };
    nextModelPreferences = {
      ...nextModelPreferences,
      [setProviderModelOrder.provider]: {
        ...preferences,
        modelOrder: [...setProviderModelOrder.modelOrder],
      },
    };
  }
  const {
    enableAssistantStreaming: _formerAssistantStreaming,
    enableLegacyTokenStreaming: _formerTokenStreaming,
    ...currentForMerge
  } = current;
  const legacyStreamingChoice = enableLegacyTokenStreaming ?? enableAssistantStreaming;
  const nextStreamingMode =
    responseStreamingMode ??
    (legacyStreamingChoice === undefined ? undefined : legacyStreamingChoice ? "token" : "turn");
  const next = deepMerge(currentForMerge, {
    ...patchForMerge,
    ...(nextStreamingMode === undefined ? {} : { responseStreamingMode: nextStreamingMode }),
  });
  const nextWithReplacementsBase = {
    ...next,
    favorites,
    providerModelPreferences: nextModelPreferences,
    ...(speechTranscriptionPatch?.assemblyAi !== undefined
      ? {
          speechTranscription: {
            ...current.speechTranscription,
            assemblyAi: {
              ...current.speechTranscription.assemblyAi,
              ...speechTranscriptionPatch.assemblyAi,
              apiKey: {
                ...current.speechTranscription.assemblyAi.apiKey,
                ...speechTranscriptionPatch.assemblyAi.apiKey,
              },
              projectOverrides: mergeSettingsEntries(
                current.speechTranscription.assemblyAi.projectOverrides,
                speechTranscriptionPatch.assemblyAi.projectOverrides ?? {},
              ),
            },
          },
        }
      : {}),
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
    ...resolveChatVisualModePatch(current, {
      chatVisualModeSyncRecord,
      chatVisualModeSyncRecordV2,
    }),
    ...(worktreeCleanupPatch === undefined
      ? {}
      : {
          worktreeCleanup:
            worktreeCleanupPatch?.mode === "custom"
              ? {
                  mode: "custom" as const,
                  rules: {
                    worktreeKeepWhen: next.storageCleanup.worktreeKeepWhen,
                    worktreeAfterDays: next.storageCleanup.worktreeAfterDays,
                    worktreeSettledAfterDays: next.storageCleanup.worktreeSettledAfterDays,
                    worktreeOnMerge: next.storageCleanup.worktreeOnMerge,
                    worktreeOnDelete: next.storageCleanup.worktreeOnDelete,
                    worktreeUnchanged: next.storageCleanup.worktreeUnchanged,
                    ...(current.worktreeCleanup?.mode === "custom"
                      ? current.worktreeCleanup.rules
                      : {}),
                    ...worktreeCleanupPatch.rules,
                  },
                }
              : worktreeCleanupPatch,
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
    ...(patch.worktreesDirectory !== undefined &&
    patch.worktreesDirectory !== current.worktreesDirectory
      ? {
          previousWorktreesDirectories: [
            ...current.previousWorktreesDirectories.filter(
              (directory) => directory !== patch.worktreesDirectory,
            ),
            ...(current.worktreesDirectory !== "" &&
            !current.previousWorktreesDirectories.includes(current.worktreesDirectory)
              ? [current.worktreesDirectory]
              : []),
          ],
        }
      : {}),
    // Per host, a patched field replaces the saved one: deepMerge would keep a cleared account pin.
    ...(sourceControlHostsPatch !== undefined
      ? {
          sourceControlHosts: {
            ...current.sourceControlHosts,
            ...Object.fromEntries(
              Object.entries(sourceControlHostsPatch).map(([kind, fields]) => [
                kind,
                { ...current.sourceControlHosts[kind], ...fields },
              ]),
            ),
          },
        }
      : {}),
    ...(projectSettingsOverridesPatch !== undefined
      ? {
          projectSettingsOverrides: Object.fromEntries(
            Object.entries(
              mergeProjectSettingsOverridesPatch(
                current.projectSettingsOverrides,
                projectSettingsOverridesPatch,
              ),
            ).filter(([, entry]) => Object.keys(entry).length > 0),
          ),
        }
      : {}),
    projectChatSettings: applyProjectChatSettingsPatch(current, patch),
    ...(patch.defaultModelSelection !== undefined
      ? { defaultModelSelection: patch.defaultModelSelection }
      : {}),
    ...(patch.fallbackModelSelection !== undefined
      ? { fallbackModelSelection: patch.fallbackModelSelection }
      : {}),
    ...(patch.defaultProjectScripts !== undefined
      ? { defaultProjectScripts: patch.defaultProjectScripts }
      : {}),
    ...(usageLimitSourcesPatch !== undefined
      ? {
          usageLimitSources: mergeSettingsEntries(
            current.usageLimitSources,
            usageLimitSourcesPatch,
          ),
        }
      : {}),
    ...(secretProvidersPatch !== undefined
      ? { secretProviders: mergeSettingsEntries(current.secretProviders, secretProvidersPatch) }
      : {}),
    ...(usagePriceOverridesPatch !== undefined
      ? {
          usagePriceOverrides: mergeSettingsEntries(
            current.usagePriceOverrides,
            usagePriceOverridesPatch,
          ),
        }
      : {}),
    ...(usageModelAliasesPatch !== undefined
      ? {
          usageModelAliases: mergeSettingsEntries(
            current.usageModelAliases,
            usageModelAliasesPatch,
          ),
        }
      : {}),
    ...(patch.sourceControlWriterModelSelection !== undefined
      ? { sourceControlWriterModelSelection: patch.sourceControlWriterModelSelection }
      : {}),
    ...(contextCompactionSelectionPatch !== undefined
      ? { contextCompactionModelSelection: contextCompactionSelectionPatch }
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
    ...(projectIndexingSelectionPatch !== undefined
      ? { projectIndexingDefaultModelSelection: projectIndexingSelectionPatch }
      : {}),
    ...(patch.mcp?.servers !== undefined
      ? { mcp: { ...next.mcp, servers: patch.mcp.servers } }
      : {}),
    ...(patch.skills?.disabledSkillIds !== undefined
      ? { skills: { ...next.skills, disabledSkillIds: patch.skills.disabledSkillIds } }
      : {}),
    ...(patch.reviewGuideModelSelection !== undefined
      ? { reviewGuideModelSelection: patch.reviewGuideModelSelection }
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
    ...withIdleCompaction(nextWithReplacementsBase, patchedIdleCompaction(current, patch)),
    ...deriveLegacyProjectOverrides(nextWithReplacementsBase),
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

export function resolveModelPreferences(
  settings: Pick<ServerSettings, "favorites" | "providerModelPreferences">,
  legacy: Partial<ModelPreferences> = {},
): ModelPreferences {
  return {
    favorites: settings.favorites ?? legacy.favorites ?? [],
    providerModelPreferences:
      settings.providerModelPreferences ?? legacy.providerModelPreferences ?? {},
  };
}

/** Empty legacy values do not claim ownership before another client can migrate its saved list. */
export function modelPreferencesMigrationPatch(
  settings: Pick<ServerSettings, "favorites" | "providerModelPreferences">,
  legacy: Partial<ModelPreferences>,
): ServerSettingsPatch | null {
  const favorites =
    settings.favorites === null && (legacy.favorites?.length ?? 0) > 0
      ? legacy.favorites
      : undefined;
  const providerModelPreferences =
    settings.providerModelPreferences === null &&
    Object.keys(legacy.providerModelPreferences ?? {}).length > 0
      ? legacy.providerModelPreferences
      : undefined;
  return favorites === undefined && providerModelPreferences === undefined
    ? null
    : {
        migrateModelPreferences: {
          ...(favorites === undefined ? {} : { favorites }),
          ...(providerModelPreferences === undefined ? {} : { providerModelPreferences }),
        },
      };
}

export function isProviderInstanceEnabled(settings: ServerSettings, instanceId: string): boolean {
  const instance = settings.providerInstances[ProviderInstanceId.make(instanceId)];
  if (instance !== undefined) return resolveProviderInstanceEnabled(instance);
  const legacyDriver = settings.providers;
  return Object.hasOwn(legacyDriver, instanceId)
    ? Object.entries(legacyDriver).some(([driver, value]) => driver === instanceId && value.enabled)
    : isUnconfiguredDefaultInstanceEnabled(ProviderInstanceId.make(instanceId));
}
