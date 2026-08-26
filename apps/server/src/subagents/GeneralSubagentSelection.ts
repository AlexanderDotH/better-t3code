import {
  type ModelSelection,
  type ProviderInstanceId,
  type SelectProviderOptionDescriptor,
  type ServerProvider,
  type ServerProviderModel,
} from "@t3tools/contracts";

const REASONING_OPTION_IDS = ["reasoningEffort", "effort"] as const;

export interface GeneralSubagentSelectionRequest {
  readonly providerInstanceId?: ProviderInstanceId;
  readonly model?: string;
  readonly reasoningEffort?: string;
}

export type GeneralSubagentSelectionUnavailableReason =
  | "provider-unavailable"
  | "model-unavailable"
  | "reasoning-effort-unavailable";

export type GeneralSubagentSelectionResolution =
  | {
      readonly status: "resolved";
      readonly provider: ServerProvider;
      readonly selection: ModelSelection;
    }
  | {
      readonly status: "unavailable";
      readonly reason: GeneralSubagentSelectionUnavailableReason;
      readonly detail: string;
    };

export interface GeneralSubagentModelCatalogEntry {
  readonly instanceId: ServerProvider["instanceId"];
  readonly driver: ServerProvider["driver"];
  readonly displayName: string;
  readonly current: boolean;
  readonly models: ReadonlyArray<{
    readonly slug: string;
    readonly name: string;
    readonly current: boolean;
    readonly isDefault: boolean;
    readonly reasoningEfforts: ReadonlyArray<string>;
  }>;
}

export function isGeneralSubagentProviderAvailable(provider: ServerProvider): boolean {
  return (
    provider.enabled &&
    provider.installed &&
    provider.availability !== "unavailable" &&
    provider.status !== "error" &&
    provider.status !== "disabled" &&
    provider.auth.status !== "unauthenticated" &&
    provider.models.some((model) => model.isSelectable !== false) &&
    (provider.status !== "warning" ||
      provider.models.some((model) => model.isDefault === true && model.isSelectable !== false))
  );
}

function selectDescriptor(model: ServerProviderModel): SelectProviderOptionDescriptor | undefined {
  return model.capabilities?.optionDescriptors?.find(
    (descriptor): descriptor is SelectProviderOptionDescriptor =>
      descriptor.type === "select" && REASONING_OPTION_IDS.some((id) => descriptor.id === id),
  );
}

function reasoningEfforts(model: ServerProviderModel): ReadonlyArray<string> {
  return selectDescriptor(model)?.options.map((choice) => choice.id) ?? [];
}

function unavailable(
  reason: GeneralSubagentSelectionUnavailableReason,
  detail: string,
): GeneralSubagentSelectionResolution {
  return { status: "unavailable", reason, detail };
}

function defaultModel(provider: ServerProvider): ServerProviderModel | undefined {
  return (
    provider.models.find((candidate) => candidate.isDefault && candidate.isSelectable !== false) ??
    provider.models.find((candidate) => candidate.isSelectable !== false)
  );
}

function resolveModel(input: {
  readonly provider: ServerProvider;
  readonly parentModelSelection: ModelSelection;
  readonly requestedModel?: string;
}): ServerProviderModel | undefined {
  const modelSlug =
    input.requestedModel ??
    (input.parentModelSelection.instanceId === input.provider.instanceId
      ? input.parentModelSelection.model
      : defaultModel(input.provider)?.slug);
  return input.provider.models.find(
    (candidate) => candidate.slug === modelSlug && candidate.isSelectable !== false,
  );
}

function inheritedOptions(input: {
  readonly parentModelSelection: ModelSelection;
  readonly provider: ServerProvider;
  readonly model: ServerProviderModel;
}): NonNullable<ModelSelection["options"]> {
  if (
    input.parentModelSelection.instanceId !== input.provider.instanceId ||
    input.parentModelSelection.model !== input.model.slug
  ) {
    return [];
  }
  return [...(input.parentModelSelection.options ?? [])];
}

function withReasoningEffort(input: {
  readonly model: ServerProviderModel;
  readonly options: NonNullable<ModelSelection["options"]>;
  readonly reasoningEffort: string | undefined;
}): NonNullable<ModelSelection["options"]> | undefined {
  if (input.reasoningEffort === undefined) return input.options;
  const descriptor = selectDescriptor(input.model);
  if (!descriptor?.options.some((choice) => choice.id === input.reasoningEffort)) {
    return undefined;
  }
  return [
    ...input.options.filter((option) => option.id !== descriptor.id),
    { id: descriptor.id, value: input.reasoningEffort },
  ];
}

export function resolveGeneralSubagentSelection(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly callerProviderInstanceId: ProviderInstanceId;
  readonly parentModelSelection: ModelSelection;
  readonly request: GeneralSubagentSelectionRequest;
}): GeneralSubagentSelectionResolution {
  const instanceId = input.request.providerInstanceId ?? input.callerProviderInstanceId;
  const provider = input.providers.find((candidate) => candidate.instanceId === instanceId);
  if (!provider || !isGeneralSubagentProviderAvailable(provider)) {
    return unavailable(
      "provider-unavailable",
      `Provider instance '${instanceId}' is not available for a general subagent.`,
    );
  }

  const selectedModel = resolveModel({
    provider,
    parentModelSelection: input.parentModelSelection,
    ...(input.request.model !== undefined ? { requestedModel: input.request.model } : {}),
  });
  if (!selectedModel) {
    return unavailable(
      "model-unavailable",
      `Model '${input.request.model ?? input.parentModelSelection.model}' is not available from provider instance '${instanceId}'.`,
    );
  }

  const options = withReasoningEffort({
    model: selectedModel,
    options: inheritedOptions({
      parentModelSelection: input.parentModelSelection,
      provider,
      model: selectedModel,
    }),
    reasoningEffort: input.request.reasoningEffort,
  });
  if (!options) {
    return unavailable(
      "reasoning-effort-unavailable",
      `Reasoning effort '${input.request.reasoningEffort}' is not supported by '${selectedModel.slug}'.`,
    );
  }

  return {
    status: "resolved",
    provider,
    selection: {
      instanceId: provider.instanceId,
      model: selectedModel.slug,
      ...(options.length > 0 ? { options } : {}),
    },
  };
}

export function listGeneralSubagentModels(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly callerProviderInstanceId: ProviderInstanceId;
  readonly parentModelSelection: ModelSelection;
}): ReadonlyArray<GeneralSubagentModelCatalogEntry> {
  return input.providers
    .filter(isGeneralSubagentProviderAvailable)
    .map((provider) => ({
      instanceId: provider.instanceId,
      driver: provider.driver,
      displayName: provider.displayName ?? provider.driver,
      current: provider.instanceId === input.callerProviderInstanceId,
      models: provider.models
        .filter((model) => model.isSelectable !== false)
        .map((model) => ({
          slug: model.slug,
          name: model.name,
          current:
            provider.instanceId === input.parentModelSelection.instanceId &&
            model.slug === input.parentModelSelection.model,
          isDefault: model.isDefault === true,
          reasoningEfforts: reasoningEfforts(model),
        })),
    }))
    .sort((left, right) => Number(right.current) - Number(left.current));
}
