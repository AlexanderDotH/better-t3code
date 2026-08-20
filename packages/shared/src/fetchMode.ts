import {
  type ModelSelection,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";

export const FETCH_MODE = "repository-exploration" as const;

const CODEX_DRIVER = ProviderDriverKind.make("codex");
const DEFAULT_CODEX_INSTANCE = ProviderInstanceId.make("codex");
const SPARK_MODEL = "gpt-5.3-codex-spark";
const LUNA_MODEL = "gpt-5.6-luna";

export type FetchModelSelectionSource =
  | "manual"
  | "auto-spark"
  | "auto-luna"
  | "auto-text-generation"
  | "auto-provider-default";

export type FetchModelSelectionUnavailableReason =
  | "provider-unavailable"
  | "model-unavailable"
  | "no-fetch-provider";

export type FetchModelSelectionResolution =
  | {
      readonly status: "resolved";
      readonly source: FetchModelSelectionSource;
      readonly selection: ModelSelection;
      readonly provider: ServerProvider;
    }
  | {
      readonly status: "unavailable";
      readonly source: "manual" | "auto";
      readonly requestedSelection: ModelSelection | null;
      readonly reason: FetchModelSelectionUnavailableReason;
    };

export function resolveFetchMode(input: {
  readonly featureEnabled: boolean;
}): typeof FETCH_MODE | undefined {
  return input.featureEnabled ? FETCH_MODE : undefined;
}

export function isFetchCapableProvider(provider: ServerProvider): boolean {
  const fetchWorkers = provider.fetchWorkers;
  const budget = fetchWorkers?.maxRecommendedWorkers;
  return (
    provider.enabled &&
    provider.installed &&
    provider.availability !== "unavailable" &&
    fetchWorkers?.commandExecutionPolicy === "deny" &&
    Number.isInteger(budget) &&
    (budget ?? 0) > 0
  );
}

function exactModelIsAvailable(provider: ServerProvider, model: string): boolean {
  return provider.models.some((candidate) => candidate.slug === model);
}

function resolveManualSelection(
  providers: ReadonlyArray<ServerProvider>,
  selection: ModelSelection,
): FetchModelSelectionResolution {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  if (!provider || !isFetchCapableProvider(provider)) {
    return {
      status: "unavailable",
      source: "manual",
      requestedSelection: selection,
      reason: "provider-unavailable",
    };
  }
  if (!exactModelIsAvailable(provider, selection.model)) {
    return {
      status: "unavailable",
      source: "manual",
      requestedSelection: selection,
      reason: "model-unavailable",
    };
  }
  return { status: "resolved", source: "manual", selection, provider };
}

function orderedCodexProviders(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ServerProvider> {
  const codexProviders = providers.filter(
    (provider) => provider.driver === CODEX_DRIVER && isFetchCapableProvider(provider),
  );
  codexProviders.sort((left, right) => {
    if (left.instanceId === DEFAULT_CODEX_INSTANCE) return -1;
    if (right.instanceId === DEFAULT_CODEX_INSTANCE) return 1;
    return left.instanceId.localeCompare(right.instanceId);
  });
  return codexProviders;
}

function findBuiltInModel(
  providers: ReadonlyArray<ServerProvider>,
  slug: string,
): ServerProvider | undefined {
  return providers.find((provider) =>
    provider.models.some((model) => model.slug === slug && !model.isCustom),
  );
}

function lunaResolution(
  providers: ReadonlyArray<ServerProvider>,
): FetchModelSelectionResolution | undefined {
  const provider = findBuiltInModel(orderedCodexProviders(providers), LUNA_MODEL);
  if (!provider) return undefined;
  return {
    status: "resolved",
    source: "auto-luna",
    selection: {
      instanceId: provider.instanceId,
      model: LUNA_MODEL,
      options: [{ id: "reasoningEffort", value: "low" }],
    },
    provider,
  };
}

export function resolveFetchLunaFallback(
  providers: ReadonlyArray<ServerProvider>,
): FetchModelSelectionResolution {
  const luna = lunaResolution(providers);
  if (luna) return luna;
  const hasCodex = orderedCodexProviders(providers).length > 0;
  return {
    status: "unavailable",
    source: "auto",
    requestedSelection: null,
    reason: hasCodex ? "model-unavailable" : "no-fetch-provider",
  };
}

function resolveAutoSelection(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly textGenerationModelSelection: ModelSelection;
}): FetchModelSelectionResolution {
  const codexProviders = orderedCodexProviders(input.providers);
  const sparkProvider = findBuiltInModel(codexProviders, SPARK_MODEL);
  if (sparkProvider) {
    return {
      status: "resolved",
      source: "auto-spark",
      selection: { instanceId: sparkProvider.instanceId, model: SPARK_MODEL },
      provider: sparkProvider,
    };
  }

  const luna = lunaResolution(input.providers);
  if (luna) return luna;

  const textGenerationProvider = input.providers.find(
    (provider) => provider.instanceId === input.textGenerationModelSelection.instanceId,
  );
  if (
    textGenerationProvider &&
    isFetchCapableProvider(textGenerationProvider) &&
    exactModelIsAvailable(textGenerationProvider, input.textGenerationModelSelection.model)
  ) {
    return {
      status: "resolved",
      source: "auto-text-generation",
      selection: input.textGenerationModelSelection,
      provider: textGenerationProvider,
    };
  }

  const provider = input.providers.find(
    (candidate) => isFetchCapableProvider(candidate) && candidate.models.length > 0,
  );
  const selectedModel =
    provider?.models.find((candidate) => candidate.isDefault)?.slug ?? provider?.models[0]?.slug;
  if (provider && selectedModel) {
    return {
      status: "resolved",
      source: "auto-provider-default",
      selection: { instanceId: provider.instanceId, model: selectedModel },
      provider,
    };
  }

  return {
    status: "unavailable",
    source: "auto",
    requestedSelection: null,
    reason: "no-fetch-provider",
  };
}

export function resolveFetchModelSelection(input: {
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly fetchModelSelection: ModelSelection | null | undefined;
  readonly textGenerationModelSelection: ModelSelection;
}): FetchModelSelectionResolution {
  if (input.fetchModelSelection) {
    return resolveManualSelection(input.providers, input.fetchModelSelection);
  }
  return resolveAutoSelection(input);
}
