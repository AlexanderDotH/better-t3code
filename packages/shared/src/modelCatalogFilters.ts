import type { ModelCapabilities } from "@t3tools/contracts";

export const OPENROUTER_MODEL_FILTERS = [
  "agent-ready",
  "free",
  "reasoning",
  "vision",
  "128k",
] as const;

export type OpenRouterModelFilter = (typeof OPENROUTER_MODEL_FILTERS)[number];

export const OPENROUTER_MODEL_FEATURE_FILTERS = OPENROUTER_MODEL_FILTERS;

export interface OpenRouterModelFilterDefinition {
  readonly id: OpenRouterModelFilter;
  readonly label: string;
  readonly description: string;
}

export const OPENROUTER_MODEL_FILTER_DEFINITIONS: ReadonlyArray<OpenRouterModelFilterDefinition> = [
  {
    id: "agent-ready",
    label: "Agent ready",
    description: "Text models that support the tool calling required by T3 Code.",
  },
  {
    id: "free",
    label: "Free",
    description: "Models with zero prompt and completion token prices in the live catalog.",
  },
  {
    id: "reasoning",
    label: "Reasoning",
    description: "Models that expose at least one reasoning effort option.",
  },
  {
    id: "vision",
    label: "Vision",
    description: "Models that accept images as input.",
  },
  {
    id: "128k",
    label: "128K+",
    description: "Models with a context window of at least 128,000 tokens.",
  },
];

export const OPENROUTER_MODEL_CONTEXT_THRESHOLDS = [
  { id: "32k", label: "32K+", minimumTokens: 32_000 },
  { id: "128k", label: "128K+", minimumTokens: 128_000 },
  { id: "200k", label: "200K+", minimumTokens: 200_000 },
  { id: "1m", label: "1M+", minimumTokens: 1_000_000 },
] as const;

export type OpenRouterModelContextThreshold =
  (typeof OPENROUTER_MODEL_CONTEXT_THRESHOLDS)[number]["id"];
export type OpenRouterModelContextThresholdSelection = OpenRouterModelContextThreshold | "any";

export const OPENROUTER_MODEL_CATALOG_SORTS = [
  "catalog",
  "name",
  "context-window",
  "prompt-price",
] as const;

export type OpenRouterModelCatalogSort = (typeof OPENROUTER_MODEL_CATALOG_SORTS)[number];

export const OPENROUTER_MODEL_SORT_DEFINITIONS: ReadonlyArray<{
  readonly id: OpenRouterModelCatalogSort;
  readonly label: string;
}> = [
  { id: "catalog", label: "Catalog order" },
  { id: "name", label: "Name" },
  { id: "context-window", label: "Largest context" },
  { id: "prompt-price", label: "Lowest input price" },
];

export const DEFAULT_OPENROUTER_MODEL_FILTERS: ReadonlySet<OpenRouterModelFilter> = new Set([
  "agent-ready",
]);

export interface OpenRouterModelCatalogFilterState {
  readonly featureFilters: ReadonlySet<OpenRouterModelFilter>;
  readonly authors: ReadonlySet<string>;
  readonly contextThreshold: OpenRouterModelContextThresholdSelection;
  readonly favoritesOnly: boolean;
  readonly sort: OpenRouterModelCatalogSort;
}

export const DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE: OpenRouterModelCatalogFilterState = {
  featureFilters: DEFAULT_OPENROUTER_MODEL_FILTERS,
  authors: new Set(),
  contextThreshold: "any",
  favoritesOnly: false,
  sort: "catalog",
};

export interface OpenRouterModelCatalogViewInput extends Partial<OpenRouterModelCatalogFilterState> {
  /** Compatibility alias for the original shared matcher input. */
  readonly filters?: ReadonlySet<OpenRouterModelFilter> | undefined;
}

export interface ModelCatalogFilterCandidate {
  readonly slug?: string | undefined;
  readonly name?: string | undefined;
  readonly subProvider?: string | undefined;
  readonly isSelectable?: boolean | undefined;
  readonly capabilities?: ModelCapabilities | null | undefined;
}

export interface OpenRouterModelAuthor {
  readonly id: string;
  readonly label: string;
}

export interface OpenRouterModelCatalogFacetItem<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly count: number;
  readonly selected: boolean;
}

export type OpenRouterModelFeatureFacetItem =
  OpenRouterModelCatalogFacetItem<OpenRouterModelFilter>;
export type OpenRouterModelAuthorFacetItem = OpenRouterModelCatalogFacetItem<string>;

export interface OpenRouterModelCatalogView<
  Model extends ModelCatalogFilterCandidate = ModelCatalogFilterCandidate,
> {
  readonly models: ReadonlyArray<Model>;
  readonly totalCount: number;
  readonly matchingCount: number;
  readonly favoriteCount: number;
  readonly filterFacets: ReadonlyArray<OpenRouterModelFeatureFacetItem>;
  readonly authorFacets: ReadonlyArray<OpenRouterModelAuthorFacetItem>;
}

export interface OpenRouterModelCatalogViewOptions<
  Model extends ModelCatalogFilterCandidate = ModelCatalogFilterCandidate,
> {
  readonly isFavorite?: ((model: Model) => boolean) | undefined;
}

const AUTHOR_LABELS: Readonly<Record<string, string>> = {
  ai21: "AI21",
  alibaba: "Alibaba",
  anthropic: "Anthropic",
  cohere: "Cohere",
  deepseek: "DeepSeek",
  google: "Google",
  meta: "Meta",
  "meta-llama": "Meta",
  microsoft: "Microsoft",
  mistralai: "Mistral AI",
  nvidia: "NVIDIA",
  openai: "OpenAI",
  perplexity: "Perplexity",
  qwen: "Qwen",
  "x-ai": "xAI",
};

const CATALOG_COLLATOR = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function normalizeAuthorId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
}

function titleCaseAuthor(id: string): string {
  const knownLabel = AUTHOR_LABELS[id];
  if (knownLabel) return knownLabel;
  return id
    .split("-")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function authorLabelFromModelName(name: string | undefined, authorId: string): string | undefined {
  if (!name) return undefined;
  const separator = name.indexOf(":");
  if (separator <= 0) return undefined;
  const prefix = name.slice(0, separator).trim();
  return normalizeAuthorId(prefix) === authorId ? prefix : undefined;
}

export function resolveOpenRouterModelAuthor(
  candidate: ModelCatalogFilterCandidate,
): OpenRouterModelAuthor | null {
  const subProvider = candidate.subProvider?.trim();
  if (subProvider) {
    return { id: normalizeAuthorId(subProvider), label: subProvider };
  }
  const slug = candidate.slug?.trim();
  const separator = slug?.indexOf("/") ?? -1;
  if (!slug || separator <= 0) return null;
  const id = normalizeAuthorId(slug.slice(0, separator));
  if (!id) return null;
  return {
    id,
    label: authorLabelFromModelName(candidate.name, id) ?? titleCaseAuthor(id),
  };
}

function isAgentReady(candidate: ModelCatalogFilterCandidate): boolean {
  const capabilities = candidate.capabilities;
  return (
    candidate.isSelectable !== false &&
    capabilities?.toolSupport?.tools === true &&
    capabilities.outputModalities?.includes("text") === true
  );
}

function isFree(candidate: ModelCatalogFilterCandidate): boolean {
  const pricing = candidate.capabilities?.pricing;
  return pricing?.promptUsdPerMillion === 0 && pricing.completionUsdPerMillion === 0;
}

function supportsReasoning(candidate: ModelCatalogFilterCandidate): boolean {
  return (
    candidate.capabilities?.optionDescriptors?.some(
      (descriptor) =>
        descriptor.id === "reasoningEffort" &&
        descriptor.type === "select" &&
        descriptor.options.length > 0,
    ) === true
  );
}

function supportsVision(candidate: ModelCatalogFilterCandidate): boolean {
  return candidate.capabilities?.inputModalities?.includes("image") === true;
}

function hasLargeContext(candidate: ModelCatalogFilterCandidate): boolean {
  return (candidate.capabilities?.contextWindow?.maxTokens ?? 0) >= 128_000;
}

export function matchesOpenRouterModelFilters(
  candidate: ModelCatalogFilterCandidate,
  filters: ReadonlySet<OpenRouterModelFilter>,
): boolean {
  for (const filter of filters) {
    if (filter === "agent-ready" && !isAgentReady(candidate)) return false;
    if (filter === "free" && !isFree(candidate)) return false;
    if (filter === "reasoning" && !supportsReasoning(candidate)) return false;
    if (filter === "vision" && !supportsVision(candidate)) return false;
    if (filter === "128k" && !hasLargeContext(candidate)) return false;
  }
  return true;
}

export function matchesOpenRouterModelContextThreshold(
  candidate: ModelCatalogFilterCandidate,
  threshold: OpenRouterModelContextThresholdSelection,
): boolean {
  if (threshold === "any") return true;
  const minimumTokens = OPENROUTER_MODEL_CONTEXT_THRESHOLDS.find(
    (definition) => definition.id === threshold,
  )?.minimumTokens;
  return (
    minimumTokens !== undefined &&
    (candidate.capabilities?.contextWindow?.maxTokens ?? 0) >= minimumTokens
  );
}

function sameSet<Value>(left: ReadonlySet<Value>, right: ReadonlySet<Value>): boolean {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

export function countActiveOpenRouterModelCatalogFilters(
  state: OpenRouterModelCatalogFilterState,
): number {
  let count = state.featureFilters.size;
  count += new Set([...state.authors].map(normalizeAuthorId).filter(Boolean)).size;
  if (state.contextThreshold !== "any") count += 1;
  if (state.favoritesOnly) count += 1;
  if (state.sort !== "catalog") count += 1;
  return count;
}

export function isDefaultOpenRouterModelCatalogFilterState(
  state: OpenRouterModelCatalogFilterState,
): boolean {
  return (
    sameSet(state.featureFilters, DEFAULT_OPENROUTER_MODEL_FILTERS) &&
    state.authors.size === 0 &&
    state.contextThreshold === "any" &&
    !state.favoritesOnly &&
    state.sort === "catalog"
  );
}

interface CatalogRecord<Model extends ModelCatalogFilterCandidate> {
  readonly model: Model;
  readonly index: number;
  readonly author: OpenRouterModelAuthor | null;
}

function matchesAuthors<Model extends ModelCatalogFilterCandidate>(
  record: CatalogRecord<Model>,
  authors: ReadonlySet<string>,
): boolean {
  return authors.size === 0 || (record.author !== null && authors.has(record.author.id));
}

function matchesFavorite<Model extends ModelCatalogFilterCandidate>(
  record: CatalogRecord<Model>,
  favoritesOnly: boolean,
  isFavorite: ((model: Model) => boolean) | undefined,
): boolean {
  return !favoritesOnly || isFavorite?.(record.model) === true;
}

function catalogModelName(candidate: ModelCatalogFilterCandidate): string {
  return candidate.name?.trim() || candidate.slug?.trim() || "";
}

function compareOptionalNumber(
  left: number | undefined,
  right: number | undefined,
  direction: "ascending" | "descending",
): number {
  if (left === undefined) return right === undefined ? 0 : 1;
  if (right === undefined) return -1;
  return direction === "ascending" ? left - right : right - left;
}

function compareCatalogRecords<Model extends ModelCatalogFilterCandidate>(
  left: CatalogRecord<Model>,
  right: CatalogRecord<Model>,
  sort: OpenRouterModelCatalogSort,
): number {
  let primary = 0;
  if (sort === "context-window") {
    primary = compareOptionalNumber(
      left.model.capabilities?.contextWindow?.maxTokens,
      right.model.capabilities?.contextWindow?.maxTokens,
      "descending",
    );
  }
  if (sort === "prompt-price") {
    primary = compareOptionalNumber(
      left.model.capabilities?.pricing?.promptUsdPerMillion,
      right.model.capabilities?.pricing?.promptUsdPerMillion,
      "ascending",
    );
  }
  if (primary !== 0) return primary;
  const byName = CATALOG_COLLATOR.compare(
    catalogModelName(left.model),
    catalogModelName(right.model),
  );
  if (byName !== 0) return byName;
  const bySlug = CATALOG_COLLATOR.compare(left.model.slug ?? "", right.model.slug ?? "");
  return bySlug !== 0 ? bySlug : left.index - right.index;
}

function sortCatalogRecords<Model extends ModelCatalogFilterCandidate>(
  records: ReadonlyArray<CatalogRecord<Model>>,
  sort: OpenRouterModelCatalogSort,
): ReadonlyArray<CatalogRecord<Model>> {
  if (sort === "catalog") return records;
  return [...records].sort((left, right) => compareCatalogRecords(left, right, sort));
}

function resolvedCatalogState(
  state: OpenRouterModelCatalogViewInput,
): OpenRouterModelCatalogFilterState {
  return {
    featureFilters: state.featureFilters ?? state.filters ?? DEFAULT_OPENROUTER_MODEL_FILTERS,
    authors: new Set([...(state.authors ?? [])].map(normalizeAuthorId).filter(Boolean)),
    contextThreshold: state.contextThreshold ?? "any",
    favoritesOnly: state.favoritesOnly ?? false,
    sort: state.sort ?? "catalog",
  };
}

/**
 * Builds the provider-specific picker view in a bounded number of catalog passes.
 * Feature filters compose with AND semantics; creator selections compose with OR
 * inside their facet and AND with every feature filter.
 */
export function buildOpenRouterModelCatalogView<Model extends ModelCatalogFilterCandidate>(
  models: ReadonlyArray<Model>,
  input: OpenRouterModelCatalogViewInput = {},
  options: OpenRouterModelCatalogViewOptions<Model> = {},
): OpenRouterModelCatalogView<Model> {
  const state = resolvedCatalogState(input);
  const isFavorite = options.isFavorite;
  const records: ReadonlyArray<CatalogRecord<Model>> = models.map((model, index) => ({
    model,
    index,
    author: resolveOpenRouterModelAuthor(model),
  }));
  const isInActiveBase = (record: CatalogRecord<Model>) =>
    matchesAuthors(record, state.authors) &&
    matchesOpenRouterModelContextThreshold(record.model, state.contextThreshold) &&
    matchesFavorite(record, state.favoritesOnly, isFavorite);
  const matchingRecords = records.filter(
    (record) =>
      isInActiveBase(record) && matchesOpenRouterModelFilters(record.model, state.featureFilters),
  );
  const authorLabels = new Map<string, string>();
  const authorCounts = new Map<string, number>();
  for (const record of records) {
    if (record.author) {
      const currentLabel = authorLabels.get(record.author.id);
      if (!currentLabel || CATALOG_COLLATOR.compare(record.author.label, currentLabel) < 0) {
        authorLabels.set(record.author.id, record.author.label);
      }
    }
    if (
      record.author &&
      matchesFavorite(record, state.favoritesOnly, isFavorite) &&
      matchesOpenRouterModelContextThreshold(record.model, state.contextThreshold) &&
      matchesOpenRouterModelFilters(record.model, state.featureFilters)
    ) {
      authorCounts.set(record.author.id, (authorCounts.get(record.author.id) ?? 0) + 1);
    }
  }
  const filterFacets = OPENROUTER_MODEL_FILTER_DEFINITIONS.map((definition) => {
    const requiredFilters = new Set(state.featureFilters);
    requiredFilters.add(definition.id);
    return {
      id: definition.id,
      label: definition.label,
      count: records.filter(
        (record) =>
          isInActiveBase(record) && matchesOpenRouterModelFilters(record.model, requiredFilters),
      ).length,
      selected: state.featureFilters.has(definition.id),
    };
  });
  const authorFacets = [...authorLabels]
    .map(([id, label]) => ({
      id,
      label,
      count: authorCounts.get(id) ?? 0,
      selected: state.authors.has(id),
    }))
    .sort((left, right) => CATALOG_COLLATOR.compare(left.label, right.label));

  return {
    models: sortCatalogRecords(matchingRecords, state.sort).map((record) => record.model),
    totalCount: records.length,
    matchingCount: matchingRecords.length,
    favoriteCount: isFavorite ? records.filter((record) => isFavorite(record.model)).length : 0,
    filterFacets,
    authorFacets,
  };
}

export function modelFavoriteKey(providerInstanceId: string, model: string): string {
  return `${providerInstanceId}\u0000${model}`;
}
