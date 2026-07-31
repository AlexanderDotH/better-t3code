import {
  type ModelCapabilities,
  type ModelSelection,
  type ProviderDriverKind,
  type ProviderOptionSelection,
} from "@t3tools/contracts";

const CODEX_DRIVER = "codex";
const SERVICE_TIER_OPTION = "serviceTier";
const LEGACY_FAST_MODE_OPTION = "fastMode";
const STANDARD_SERVICE_TIER = "default";
const FAST_SERVICE_TIER = "priority";
const LEGACY_FAST_SERVICE_TIER = "fast";

type SelectDescriptor = Extract<
  NonNullable<ModelCapabilities["optionDescriptors"]>[number],
  { type: "select" }
>;

function codexServiceTierDescriptor(
  capabilities: ModelCapabilities | null | undefined,
): SelectDescriptor | null {
  return (
    capabilities?.optionDescriptors?.find(
      (descriptor): descriptor is SelectDescriptor =>
        descriptor.id === SERVICE_TIER_OPTION && descriptor.type === "select",
    ) ?? null
  );
}

function hasNativeFastModeDescriptor(capabilities: ModelCapabilities | null | undefined): boolean {
  return (
    capabilities?.optionDescriptors?.some(
      (descriptor) => descriptor.id === LEGACY_FAST_MODE_OPTION && descriptor.type === "boolean",
    ) === true
  );
}

function optionValue(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
  id: string,
): string | boolean | undefined {
  return options?.find((option) => option.id === id)?.value;
}

function descriptorFallback(descriptor: SelectDescriptor): string | undefined {
  const optionIds = new Set(descriptor.options.map((option) => option.id));
  if (optionIds.has(STANDARD_SERVICE_TIER)) {
    return STANDARD_SERVICE_TIER;
  }
  const declaredDefault = descriptor.options.find((option) => option.isDefault)?.id;
  if (declaredDefault) {
    return declaredDefault;
  }
  if (descriptor.currentValue && optionIds.has(descriptor.currentValue)) {
    return descriptor.currentValue;
  }
  return descriptor.options[0]?.id;
}

function resolveRequestedServiceTier(
  selection: ModelSelection,
  descriptor: SelectDescriptor,
): string | undefined {
  const optionIds = new Set(descriptor.options.map((option) => option.id));
  const selectedTier = optionValue(selection.options, SERVICE_TIER_OPTION);
  const legacyFastMode = optionValue(selection.options, LEGACY_FAST_MODE_OPTION);
  const requested =
    typeof selectedTier === "string"
      ? selectedTier
      : legacyFastMode === true
        ? FAST_SERVICE_TIER
        : legacyFastMode === false
          ? STANDARD_SERVICE_TIER
          : undefined;

  if (requested === FAST_SERVICE_TIER || requested === LEGACY_FAST_SERVICE_TIER) {
    if (optionIds.has(FAST_SERVICE_TIER)) {
      return FAST_SERVICE_TIER;
    }
    if (optionIds.has(LEGACY_FAST_SERVICE_TIER)) {
      return LEGACY_FAST_SERVICE_TIER;
    }
    return descriptorFallback(descriptor);
  }
  if (requested && optionIds.has(requested)) {
    return requested;
  }
  return descriptorFallback(descriptor);
}

function withoutCodexSpeedOptions(
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): Array<ProviderOptionSelection> {
  return (options ?? []).filter(
    (option) => option.id !== SERVICE_TIER_OPTION && option.id !== LEGACY_FAST_MODE_OPTION,
  );
}

function withOptions(
  selection: ModelSelection,
  options: ReadonlyArray<ProviderOptionSelection>,
): ModelSelection {
  if (options.length > 0) {
    return { ...selection, options };
  }
  return {
    instanceId: selection.instanceId,
    model: selection.model,
  };
}

export function normalizeClientModelSelection(input: {
  readonly provider: ProviderDriverKind;
  readonly selection: ModelSelection;
  readonly capabilities: ModelCapabilities | null | undefined;
}): ModelSelection {
  if (input.provider !== CODEX_DRIVER) {
    return input.selection;
  }

  const remainingOptions = withoutCodexSpeedOptions(input.selection.options);
  const descriptor = codexServiceTierDescriptor(input.capabilities);
  if (!descriptor && hasNativeFastModeDescriptor(input.capabilities)) {
    return input.selection;
  }
  if (!descriptor || descriptor.options.length === 0) {
    return withOptions(input.selection, remainingOptions);
  }

  const serviceTier = resolveRequestedServiceTier(input.selection, descriptor);
  return withOptions(
    input.selection,
    serviceTier
      ? [...remainingOptions, { id: SERVICE_TIER_OPTION, value: serviceTier }]
      : remainingOptions,
  );
}

export function toStickyModelSelection(input: {
  readonly provider: ProviderDriverKind;
  readonly selection: ModelSelection;
}): ModelSelection {
  if (input.provider !== CODEX_DRIVER) {
    return input.selection;
  }
  return withOptions(input.selection, withoutCodexSpeedOptions(input.selection.options));
}
