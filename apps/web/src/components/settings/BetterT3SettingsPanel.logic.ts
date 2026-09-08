import {
  type BetterT3FeatureControlStateV1,
  type BetterT3FeatureDescriptor,
  type BetterT3FeatureId,
  type BetterT3FeatureScope,
  type BetterT3SettingsV1,
  type BetterT3Surface,
  type BetterT3SwitchFeatureId,
  type ClientSettingsPatch,
  ProviderDriverKind,
  type ServerSettingsPatch,
  resolveBetterT3FeatureFlag,
} from "@t3tools/contracts";
import { isInterfaceMessageKey } from "@t3tools/shared/interfaceLanguage";

type BetterT3FeatureLabelMessageKey = `betterT3.${BetterT3FeatureId}.label`;
type BetterT3FeatureDescriptionMessageKey = `betterT3.${BetterT3FeatureId}.description`;

export interface BetterT3DescriptorMessageKeys {
  readonly labelMessageId: BetterT3FeatureLabelMessageKey;
  readonly descriptionMessageId: BetterT3FeatureDescriptionMessageKey;
}

export function resolveBetterT3DescriptorMessageKeys(
  descriptor: Pick<BetterT3FeatureDescriptor, "id" | "labelMessageId" | "descriptionMessageId">,
): BetterT3DescriptorMessageKeys {
  const expectedLabelMessageId: BetterT3FeatureLabelMessageKey = `betterT3.${descriptor.id}.label`;
  const expectedDescriptionMessageId: BetterT3FeatureDescriptionMessageKey = `betterT3.${descriptor.id}.description`;
  const labelMessageId =
    isInterfaceMessageKey(descriptor.labelMessageId) &&
    descriptor.labelMessageId === expectedLabelMessageId
      ? descriptor.labelMessageId
      : expectedLabelMessageId;
  const descriptionMessageId =
    isInterfaceMessageKey(descriptor.descriptionMessageId) &&
    descriptor.descriptionMessageId === expectedDescriptionMessageId
      ? descriptor.descriptionMessageId
      : expectedDescriptionMessageId;

  return { labelMessageId, descriptionMessageId };
}

export const ADDITIONAL_BETTER_T3_PROVIDER_DRIVERS = [
  ProviderDriverKind.make("chatgpt"),
  ProviderDriverKind.make("gemini"),
  ProviderDriverKind.make("openrouter"),
  ProviderDriverKind.make("openai"),
] as const satisfies ReadonlyArray<ProviderDriverKind>;

const additionalProviderDrivers = new Set<ProviderDriverKind>(
  ADDITIONAL_BETTER_T3_PROVIDER_DRIVERS,
);

export function partitionBetterT3ProviderRows<T extends { readonly driver: ProviderDriverKind }>(
  rows: ReadonlyArray<T>,
): { readonly core: ReadonlyArray<T>; readonly additional: ReadonlyArray<T> } {
  const core: T[] = [];
  const additional: T[] = [];
  for (const row of rows) {
    (additionalProviderDrivers.has(row.driver) ? additional : core).push(row);
  }
  return { core, additional };
}

export interface BetterT3SwitchState {
  readonly descriptor: BetterT3FeatureDescriptor & {
    readonly id: BetterT3SwitchFeatureId;
    readonly controlKind: "switch";
  };
  readonly enabled: boolean;
  readonly availability: "available" | "blocked" | "unavailable" | "unsupported";
}

type CapabilityValues = Readonly<Record<string, number | boolean | undefined>>;

interface BetterT3ControlStateInput {
  readonly registry: ReadonlyArray<BetterT3FeatureDescriptor>;
  readonly device: BetterT3SettingsV1;
  readonly environment: BetterT3SettingsV1;
  readonly surface: BetterT3Surface;
  readonly capabilities: CapabilityValues;
  readonly environmentAvailable?: boolean;
}

function baseAvailability(
  descriptor: BetterT3FeatureDescriptor,
  input: Pick<BetterT3ControlStateInput, "surface" | "capabilities" | "environmentAvailable">,
): "available" | "unavailable" | "unsupported" {
  if (!descriptor.availability.surfaces.includes(input.surface)) return "unsupported";
  if (descriptor.scope !== "device" && input.environmentAvailable === false) {
    return "unavailable";
  }
  return supportsCapabilities(descriptor, input.capabilities) ? "available" : "unsupported";
}

export function resolveSelectedBetterT3EnvironmentId<EnvironmentId extends string>(
  options: ReadonlyArray<{ readonly environmentId: EnvironmentId }>,
  requestedEnvironmentId: EnvironmentId | null,
  primaryEnvironmentId: EnvironmentId | null,
): EnvironmentId | null {
  if (
    requestedEnvironmentId !== null &&
    options.some((option) => option.environmentId === requestedEnvironmentId)
  ) {
    return requestedEnvironmentId;
  }
  if (
    primaryEnvironmentId !== null &&
    options.some((option) => option.environmentId === primaryEnvironmentId)
  ) {
    return primaryEnvironmentId;
  }
  return options[0]?.environmentId ?? null;
}

function supportsCapabilities(
  descriptor: BetterT3FeatureDescriptor,
  capabilities: CapabilityValues,
): boolean {
  return descriptor.availability.capabilities.every((requirement) => {
    const value = capabilities[requirement.name];
    if (typeof requirement.minimumVersion === "number") {
      return typeof value === "number" && value >= requirement.minimumVersion;
    }
    return value !== undefined && value !== false;
  });
}

export function buildBetterT3SwitchStates(input: {
  readonly registry: ReadonlyArray<BetterT3FeatureDescriptor>;
  readonly device: BetterT3SettingsV1;
  readonly environment: BetterT3SettingsV1;
  readonly surface: BetterT3Surface;
  readonly capabilities: CapabilityValues;
  readonly environmentAvailable?: boolean;
}): ReadonlyArray<BetterT3SwitchState> {
  const switchDescriptors = input.registry.filter(
    (descriptor): descriptor is BetterT3SwitchState["descriptor"] =>
      descriptor.controlKind === "switch",
  );
  const enabledById = new Map<BetterT3SwitchFeatureId, boolean>(
    switchDescriptors.map((descriptor) => {
      const settings = descriptor.scope === "device" ? input.device : input.environment;
      return [descriptor.id, resolveBetterT3FeatureFlag(settings, descriptor.id)] as const;
    }),
  );
  const availabilityById = new Map(
    input.registry.map((descriptor) => [descriptor.id, baseAvailability(descriptor, input)]),
  );

  return switchDescriptors.map((descriptor) => {
    const base = availabilityById.get(descriptor.id) ?? "unsupported";
    const dependenciesMet = descriptor.dependencies.every((dependency) =>
      dependency.condition === "enabled"
        ? availabilityById.get(dependency.featureId) === "available" &&
          enabledById.get(dependency.featureId as BetterT3SwitchFeatureId) === true
        : availabilityById.get(dependency.featureId) === "available",
    );
    return {
      descriptor,
      enabled: enabledById.get(descriptor.id) === true,
      availability: base === "available" && !dependenciesMet ? "blocked" : base,
    };
  });
}

function settingsForDescriptor(
  input: BetterT3ControlStateInput,
  descriptor: BetterT3FeatureDescriptor,
): BetterT3SettingsV1 {
  return descriptor.scope === "device" ? input.device : input.environment;
}

export function buildBetterT3ControlStates(
  input: BetterT3ControlStateInput,
): ReadonlyArray<BetterT3FeatureControlStateV1> {
  const availabilityById = new Map<BetterT3FeatureId, "available" | "unavailable" | "unsupported">(
    input.registry.map((descriptor) => [descriptor.id, baseAvailability(descriptor, input)]),
  );
  const enabledById = new Map<BetterT3SwitchFeatureId, boolean>(
    input.registry.flatMap((descriptor) =>
      descriptor.controlKind === "switch"
        ? [
            [
              descriptor.id as BetterT3SwitchFeatureId,
              resolveBetterT3FeatureFlag(
                settingsForDescriptor(input, descriptor),
                descriptor.id as BetterT3SwitchFeatureId,
              ),
            ] as const,
          ]
        : [],
    ),
  );

  return input.registry.map((descriptor) => {
    const base = availabilityById.get(descriptor.id) ?? "unsupported";
    const dependenciesMet = descriptor.dependencies.every((dependency) =>
      dependency.condition === "enabled"
        ? availabilityById.get(dependency.featureId) === "available" &&
          enabledById.get(dependency.featureId as BetterT3SwitchFeatureId) === true
        : availabilityById.get(dependency.featureId) === "available",
    );
    const settings = settingsForDescriptor(input, descriptor);
    const explicit = Object.hasOwn(settings.flags, descriptor.id);
    return {
      descriptor,
      availability: {
        state: base === "available" && !dependenciesMet ? "blocked" : base,
      },
      value:
        descriptor.controlKind === "switch"
          ? (enabledById.get(descriptor.id as BetterT3SwitchFeatureId) ?? false)
          : null,
      source: explicit ? "better-t3" : "default",
    };
  });
}

export function updateBetterT3FeatureFlag(
  settings: BetterT3SettingsV1,
  featureId: BetterT3SwitchFeatureId,
  enabled: boolean,
): BetterT3SettingsV1 {
  return {
    ...settings,
    flags: { ...settings.flags, [featureId]: enabled },
  };
}

type BetterT3SwitchSettingsPatch = ClientSettingsPatch & ServerSettingsPatch;

function deviceCompatibilityPatch(
  featureId: BetterT3SwitchFeatureId,
  enabled: boolean,
): ClientSettingsPatch {
  switch (featureId) {
    case "agent.fetch":
      return { experimentalFetch: enabled };
    case "agent.parallelPlanImplementation":
      return { experimentalParallelPlanImplementation: enabled };
    case "agent.planMode":
      return { planModeEnabled: enabled };
    case "agent.promptImprovement":
      return { improvePromptBeforeSend: enabled };
    case "agent.expandedComposerControls":
      return { showExpandedComposerControls: enabled };
    case "agent.reasoningVisibility":
      return { showReasoning: enabled };
    case "chat.classicSidebar":
      return { legacySidebarEnabled: enabled };
    default:
      return {};
  }
}

function environmentCompatibilityPatch(
  featureId: BetterT3SwitchFeatureId,
  enabled: boolean,
): ServerSettingsPatch {
  if (featureId !== "agent.deepThinking") return {};
  return { agentEnhancement: { deepThinking: { enabled } } };
}

export function buildBetterT3SwitchSettingsPatch(
  featureId: BetterT3SwitchFeatureId,
  enabled: boolean,
  scope: BetterT3FeatureScope,
): BetterT3SwitchSettingsPatch {
  if (scope === "device") {
    return {
      betterT3Device: { version: 1, flags: { [featureId]: enabled } },
      ...deviceCompatibilityPatch(featureId, enabled),
    };
  }
  return {
    betterT3Environment: { version: 1, flags: { [featureId]: enabled } },
    ...environmentCompatibilityPatch(featureId, enabled),
  };
}
