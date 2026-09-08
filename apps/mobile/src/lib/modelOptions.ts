import { isStartedThreadModelChangeAllowed } from "@t3tools/client-runtime/provider-selection";
import {
  ProviderDriverKind,
  type ModelCapabilities,
  type ModelSelection,
  type ServerConfig as T3ServerConfig,
} from "@t3tools/contracts";
import { normalizeClientModelSelection } from "@t3tools/client-runtime/model-options";
import {
  buildExplicitProviderOptionSelectionsFromDescriptors,
  enableAutoReasoning,
  getProviderOptionDescriptors,
  isAutoReasoningEnabled,
} from "@t3tools/shared/model";

export type ModelOption = {
  readonly key: string;
  readonly label: string;
  readonly subtitle: string;
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly providerDriver: string;
  readonly isDefault: boolean;
  readonly isLegacy: boolean;
  readonly isUnavailable?: boolean;
  readonly isSelectable: boolean;
  readonly unavailableReason: string | null;
  readonly continuationGroupKey: string | null;
  readonly requiresNewThreadForModelChange: boolean;
  readonly capabilities: ModelCapabilities | null;
  readonly selection: ModelSelection;
};

export type ProviderGroup = {
  readonly providerKey: string;
  readonly providerLabel: string;
  readonly models: ReadonlyArray<ModelOption>;
};

function providerDisplayLabel(provider: {
  readonly displayName?: string | undefined;
  readonly driver: string;
  readonly instanceId: string;
}): string {
  if (provider.displayName) return provider.displayName;
  if (provider.driver === "codex") return "Codex";
  if (provider.driver === "claudeAgent") return "Claude";
  return provider.instanceId;
}

function normalizeSelectionOptions(
  selection: ModelSelection,
  capabilities: ModelCapabilities | null,
  provider: ProviderDriverKind,
): ModelSelection {
  const normalizedSelection = normalizeClientModelSelection({
    provider,
    selection,
    capabilities,
  });
  if (!capabilities) return normalizedSelection;

  const options = buildExplicitProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({
      caps: capabilities,
      selections: normalizedSelection.options,
    }),
    normalizedSelection.options,
  );
  const descriptorSelection = options
    ? { ...normalizedSelection, options }
    : {
        instanceId: normalizedSelection.instanceId,
        model: normalizedSelection.model,
      };
  return isAutoReasoningEnabled(normalizedSelection)
    ? enableAutoReasoning(descriptorSelection)
    : descriptorSelection;
}

/** Whether a known Antigravity selection needs setup or a different model. */
export function isModelSelectionUnavailable(
  config: T3ServerConfig | null | undefined,
  selection: ModelSelection | null | undefined,
): boolean {
  if (!config || !selection) {
    return false;
  }
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  const driver =
    provider?.driver ?? config.settings?.providerInstances[selection.instanceId]?.driver;
  return (
    driver === "antigravity" &&
    (!provider ||
      !provider.enabled ||
      !provider.installed ||
      provider.auth.status === "unauthenticated" ||
      provider.availability === "unavailable" ||
      !provider.models.some((model) => model.slug === selection.model))
  );
}

/**
 * Keep Antigravity selections when setup or catalog changes make them
 * unavailable. Other providers fall through to the server default when they
 * are disabled, missing, or signed out. Without config, keep stored selections.
 */
export function resolveSelectableModelSelection(
  config: T3ServerConfig | null | undefined,
  selection: ModelSelection | null,
): ModelSelection | null {
  if (!selection || !config) {
    return selection;
  }
  const provider = config.providers.find(
    (candidate) => candidate.instanceId === selection.instanceId,
  );
  const driver =
    provider?.driver ?? config.settings?.providerInstances[selection.instanceId]?.driver;
  if (driver === "antigravity") {
    return selection;
  }
  const model = provider?.models.find((candidate) => candidate.slug === selection.model);
  return provider &&
    provider.enabled &&
    provider.installed &&
    provider.auth.status !== "unauthenticated" &&
    model?.isSelectable !== false
    ? selection
    : null;
}

/**
 * Reject legacy models for implicit defaults, except Antigravity selections,
 * which must not silently change after a catalog update. Explicit picks in
 * the settings sheet are unaffected.
 */
export function resolveDefaultableModelSelection(
  config: T3ServerConfig | null | undefined,
  selection: ModelSelection | null,
): ModelSelection | null {
  const usable = resolveSelectableModelSelection(config, selection);
  if (!usable || !config) {
    return usable;
  }
  const provider = config.providers.find((candidate) => candidate.instanceId === usable.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === usable.model);
  return provider?.driver !== "antigravity" && model?.isLegacy === true ? null : usable;
}

export function resolveNewTaskModelSelection(input: {
  readonly draftSelection: ModelSelection | null;
  readonly projectDefaultSelection: ModelSelection | null;
  readonly stickySelection: ModelSelection | null;
  readonly modelOptions: ReadonlyArray<ModelOption>;
}): ModelSelection | null {
  return (
    input.draftSelection ??
    input.projectDefaultSelection ??
    input.stickySelection ??
    input.modelOptions.find((option) => option.isDefault && !option.isUnavailable)?.selection ??
    input.modelOptions.find((option) => !option.isUnavailable)?.selection ??
    null
  );
}

export function buildModelOptions(
  config: T3ServerConfig | null | undefined,
  fallbackModelSelection: ModelSelection | null,
): ReadonlyArray<ModelOption> {
  const options = new Map<string, ModelOption>();

  for (const provider of config?.providers ?? []) {
    if (
      !provider.enabled ||
      !provider.installed ||
      provider.auth.status === "unauthenticated" ||
      (provider.driver === "antigravity" && provider.availability === "unavailable")
    ) {
      continue;
    }

    const providerLabel = providerDisplayLabel(provider);
    for (const model of provider.models) {
      const key = `${provider.instanceId}:${model.slug}`;
      options.set(key, {
        key,
        label: model.name,
        subtitle: model.subProvider ?? "",
        providerKey: provider.instanceId,
        providerLabel,
        providerDriver: provider.driver,
        isDefault: model.isDefault === true,
        isLegacy: model.isLegacy === true,
        isSelectable: model.isSelectable !== false,
        unavailableReason: model.unavailableReason ?? null,
        continuationGroupKey: provider.continuation?.groupKey ?? null,
        requiresNewThreadForModelChange: provider.requiresNewThreadForModelChange === true,
        capabilities: model.capabilities,
        selection: normalizeSelectionOptions(
          {
            instanceId: provider.instanceId,
            model: model.slug,
          },
          model.capabilities,
          provider.driver,
        ),
      });
    }
  }

  if (fallbackModelSelection) {
    const key = `${fallbackModelSelection.instanceId}:${fallbackModelSelection.model}`;
    const existing = options.get(key);
    if (existing) {
      options.set(key, {
        ...existing,
        selection:
          existing.providerDriver === "antigravity"
            ? fallbackModelSelection
            : normalizeSelectionOptions(
                fallbackModelSelection,
                existing.capabilities,
                ProviderDriverKind.make(existing.providerDriver),
              ),
      });
    } else {
      const provider = config?.providers.find(
        (candidate) => candidate.instanceId === fallbackModelSelection.instanceId,
      );
      const instanceConfig = config?.settings?.providerInstances[fallbackModelSelection.instanceId];
      const model = provider?.models.find(
        (candidate) => candidate.slug === fallbackModelSelection.model,
      );
      const providerDriver =
        provider?.driver ?? instanceConfig?.driver ?? fallbackModelSelection.instanceId;
      const providerLabel = providerDisplayLabel({
        driver: providerDriver,
        displayName: provider?.displayName ?? instanceConfig?.displayName,
        instanceId: fallbackModelSelection.instanceId,
      });
      options.set(key, {
        key,
        label: model?.name ?? fallbackModelSelection.model,
        subtitle: model?.subProvider ?? "",
        providerKey: fallbackModelSelection.instanceId,
        providerLabel,
        providerDriver,
        isDefault: false,
        isLegacy: model?.isLegacy === true,
        isSelectable: model?.isSelectable !== false,
        unavailableReason: model?.unavailableReason ?? null,
        continuationGroupKey: provider?.continuation?.groupKey ?? null,
        requiresNewThreadForModelChange: provider?.requiresNewThreadForModelChange === true,
        ...(isModelSelectionUnavailable(config, fallbackModelSelection)
          ? { isUnavailable: true }
          : {}),
        capabilities: model?.capabilities ?? null,
        selection: fallbackModelSelection,
      });
    }
  }

  return [...options.values()];
}

export function groupByProvider(options: ReadonlyArray<ModelOption>): ReadonlyArray<ProviderGroup> {
  const groups = new Map<string, { providerLabel: string; models: ModelOption[] }>();
  for (const option of options) {
    const existing = groups.get(option.providerKey);
    if (existing) {
      existing.models.push(option);
    } else {
      groups.set(option.providerKey, {
        providerLabel: option.providerLabel,
        models: [option],
      });
    }
  }

  return [...groups.entries()].map(([providerKey, group]) => ({
    providerKey,
    providerLabel: group.providerLabel,
    models: group.models,
  }));
}

export function filterStartedThreadModelOptions(input: {
  readonly options: ReadonlyArray<ModelOption>;
  readonly currentSelection: ModelSelection;
  readonly currentProviderInstanceId?: ModelSelection["instanceId"] | null;
  readonly hasStarted: boolean;
  readonly allowMidChatProviderSwitching: boolean;
}): ReadonlyArray<ModelOption> {
  if (!input.hasStarted || input.allowMidChatProviderSwitching) {
    return input.options;
  }

  const currentInstanceId = input.currentProviderInstanceId ?? input.currentSelection.instanceId;
  const current = input.options.find(
    (option) =>
      option.selection.instanceId === currentInstanceId &&
      option.selection.model === input.currentSelection.model,
  );
  if (!current) {
    return input.options.filter(
      (option) =>
        option.selection.instanceId === input.currentSelection.instanceId &&
        option.selection.model === input.currentSelection.model,
    );
  }

  return input.options.filter((option) => {
    if (option.providerDriver !== current.providerDriver) return false;
    if (
      current.continuationGroupKey !== null &&
      option.continuationGroupKey !== null &&
      option.continuationGroupKey !== current.continuationGroupKey
    ) {
      return false;
    }
    return isStartedThreadModelChangeAllowed({ hasStarted: input.hasStarted, allowMidChatProviderSwitching: input.allowMidChatProviderSwitching, currentSelection: input.currentSelection, nextSelection: option.selection, currentProviderInstanceId: input.currentProviderInstanceId, currentRequiresNewThread: current.requiresNewThreadForModelChange, nextRequiresNewThread: option.requiresNewThreadForModelChange });
  });
}
