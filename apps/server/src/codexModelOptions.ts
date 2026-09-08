import type { ModelCapabilities, ModelSelection } from "@t3tools/contracts";
import {
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
} from "@t3tools/shared/model";

export const CODEX_DEFAULT_SERVICE_TIER = "default";
export const CODEX_FAST_SERVICE_TIER = "priority";
const LEGACY_CODEX_FAST_SERVICE_TIER = "fast";

function canonicalizeCodexServiceTier(value: string): string {
  return value === LEGACY_CODEX_FAST_SERVICE_TIER ? CODEX_FAST_SERVICE_TIER : value;
}

export function getCodexServiceTierOptionValue(
  modelSelection: ModelSelection | null | undefined,
): string | undefined {
  const selectedTier = getModelSelectionStringOptionValue(modelSelection, "serviceTier");
  if (selectedTier !== undefined) {
    return canonicalizeCodexServiceTier(selectedTier);
  }

  const legacyFastMode = getModelSelectionBooleanOptionValue(modelSelection, "fastMode");
  if (legacyFastMode === true) {
    return CODEX_FAST_SERVICE_TIER;
  }
  if (legacyFastMode === false) {
    return CODEX_DEFAULT_SERVICE_TIER;
  }
  return undefined;
}

function serviceTierFallback(
  descriptor: Extract<
    NonNullable<ModelCapabilities["optionDescriptors"]>[number],
    { type: "select" }
  >,
): string | undefined {
  const optionIds = new Set(descriptor.options.map((option) => option.id));
  if (optionIds.has(CODEX_DEFAULT_SERVICE_TIER)) {
    return CODEX_DEFAULT_SERVICE_TIER;
  }
  const declaredDefault = descriptor.options.find((option) => option.isDefault)?.id;
  if (declaredDefault !== undefined) {
    return declaredDefault;
  }
  return descriptor.currentValue !== undefined && optionIds.has(descriptor.currentValue)
    ? descriptor.currentValue
    : undefined;
}

/**
 * Canonicalize persisted Codex speed options at the server boundary.
 *
 * `undefined` capabilities mean that no catalog entry was available, so the
 * compatibility alias is still normalized but the requested tier is retained.
 * A known catalog without `serviceTier` support removes the option instead of
 * sending a tier that the selected model did not advertise.
 */
export function normalizeCodexModelSelectionServiceTier(
  modelSelection: ModelSelection,
  capabilities: ModelCapabilities | null | undefined,
): ModelSelection {
  const requestedTier = getCodexServiceTierOptionValue(modelSelection);
  const remainingOptions = (modelSelection.options ?? []).filter(
    (option) => option.id !== "serviceTier" && option.id !== "fastMode",
  );

  let resolvedTier = requestedTier;
  if (capabilities !== undefined) {
    const descriptor = capabilities?.optionDescriptors?.find(
      (candidate): candidate is Extract<typeof candidate, { type: "select" }> =>
        candidate.id === "serviceTier" && candidate.type === "select",
    );
    if (!descriptor || descriptor.options.length === 0) {
      resolvedTier = undefined;
    } else {
      const optionIds = new Set(descriptor.options.map((option) => option.id));
      const fallback = serviceTierFallback(descriptor);
      if (requestedTier === CODEX_FAST_SERVICE_TIER) {
        resolvedTier = optionIds.has(CODEX_FAST_SERVICE_TIER)
          ? CODEX_FAST_SERVICE_TIER
          : optionIds.has(LEGACY_CODEX_FAST_SERVICE_TIER)
            ? LEGACY_CODEX_FAST_SERVICE_TIER
            : fallback;
      } else if (requestedTier !== undefined && optionIds.has(requestedTier)) {
        resolvedTier = requestedTier;
      } else {
        resolvedTier = fallback;
      }
    }
  }

  const options =
    resolvedTier === undefined
      ? remainingOptions
      : [...remainingOptions, { id: "serviceTier", value: resolvedTier }];
  return options.length > 0
    ? { ...modelSelection, options }
    : {
        instanceId: modelSelection.instanceId,
        model: modelSelection.model,
      };
}
