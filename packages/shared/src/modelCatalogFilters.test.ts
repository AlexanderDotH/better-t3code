import { describe, expect, it } from "vite-plus/test";

import {
  buildOpenRouterModelCatalogView,
  countActiveOpenRouterModelCatalogFilters,
  DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE,
  DEFAULT_OPENROUTER_MODEL_FILTERS,
  isDefaultOpenRouterModelCatalogFilterState,
  matchesOpenRouterModelFilters,
  modelFavoriteKey,
  OPENROUTER_MODEL_CONTEXT_THRESHOLDS,
  OPENROUTER_MODEL_FILTER_DEFINITIONS,
  resolveOpenRouterModelAuthor,
} from "./modelCatalogFilters.ts";

const agentModel = {
  isSelectable: true,
  capabilities: {
    contextWindow: { defaultTokens: 200_000, maxTokens: 200_000 },
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    pricing: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
    toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
    optionDescriptors: [
      {
        id: "reasoningEffort",
        label: "Reasoning",
        type: "select" as const,
        options: [{ id: "high", label: "High" }],
      },
    ],
  },
};

describe("OpenRouter model catalog filters", () => {
  it("defaults to agent-ready models and composes capability filters with AND semantics", () => {
    expect(matchesOpenRouterModelFilters(agentModel, DEFAULT_OPENROUTER_MODEL_FILTERS)).toBe(true);
    expect(
      matchesOpenRouterModelFilters(agentModel, new Set(["free", "reasoning", "vision", "128k"])),
    ).toBe(true);
    expect(
      matchesOpenRouterModelFilters(
        { ...agentModel, capabilities: { ...agentModel.capabilities, pricing: undefined } },
        new Set(["free"]),
      ),
    ).toBe(false);
    expect(
      matchesOpenRouterModelFilters(
        { ...agentModel, isSelectable: false },
        new Set(["agent-ready"]),
      ),
    ).toBe(false);
  });

  it("keys favorites by provider instance and model without cross-instance collisions", () => {
    expect(modelFavoriteKey("openrouter", "openai/gpt-5.5")).toBe("openrouter\u0000openai/gpt-5.5");
    expect(modelFavoriteKey("openrouter_work", "openai/gpt-5.5")).not.toBe(
      modelFavoriteKey("openrouter", "openai/gpt-5.5"),
    );
  });

  it("publishes stable feature metadata with clear picker labels", () => {
    expect(OPENROUTER_MODEL_FILTER_DEFINITIONS).toEqual([
      expect.objectContaining({ id: "agent-ready", label: "Agent ready" }),
      expect.objectContaining({ id: "free", label: "Free" }),
      expect.objectContaining({ id: "reasoning", label: "Reasoning" }),
      expect.objectContaining({ id: "vision", label: "Vision" }),
      expect.objectContaining({ id: "128k", label: "128K+" }),
    ]);
    expect(
      OPENROUTER_MODEL_FILTER_DEFINITIONS.every(
        (definition) => definition.description.trim().length > 0,
      ),
    ).toBe(true);
  });

  it("derives deterministic author facets from provider metadata or OpenRouter slugs", () => {
    expect(
      resolveOpenRouterModelAuthor({
        slug: "openai/gpt-5.5",
        name: "OpenAI: GPT-5.5",
      }),
    ).toEqual({ id: "openai", label: "OpenAI" });
    expect(
      resolveOpenRouterModelAuthor({
        slug: "vendor/model",
        subProvider: "Vendor Labs",
      }),
    ).toEqual({ id: "vendor-labs", label: "Vendor Labs" });
    expect(resolveOpenRouterModelAuthor({ slug: "standalone-model" })).toBeNull();
  });

  it("builds contextual feature and author counts with AND semantics", () => {
    const catalog = [
      {
        ...agentModel,
        slug: "openai/free-vision",
        name: "OpenAI: Free Vision",
      },
      {
        ...agentModel,
        slug: "anthropic/reasoner",
        name: "Anthropic: Reasoner",
        capabilities: {
          ...agentModel.capabilities,
          inputModalities: ["text"],
          pricing: { promptUsdPerMillion: 2, completionUsdPerMillion: 8 },
        },
      },
      {
        ...agentModel,
        slug: "openai/text-only",
        name: "OpenAI: Text Only",
        capabilities: {
          ...agentModel.capabilities,
          contextWindow: { defaultTokens: 64_000, maxTokens: 64_000 },
          inputModalities: ["text"],
          optionDescriptors: [],
        },
      },
      {
        ...agentModel,
        slug: "google/no-tools",
        name: "Google: No Tools",
        isSelectable: false,
      },
    ] as const;

    const view = buildOpenRouterModelCatalogView(catalog, {
      filters: new Set(["agent-ready", "reasoning", "vision"]),
    });

    expect(view.models.map((model) => model.slug)).toEqual(["openai/free-vision"]);
    expect(view.totalCount).toBe(4);
    expect(view.matchingCount).toBe(1);
    expect(Object.fromEntries(view.filterFacets.map((facet) => [facet.id, facet.count]))).toEqual({
      "agent-ready": 1,
      free: 1,
      reasoning: 1,
      vision: 1,
      "128k": 1,
    });
    expect(view.authorFacets).toEqual([
      { id: "anthropic", label: "Anthropic", count: 0, selected: false },
      { id: "google", label: "Google", count: 0, selected: false },
      { id: "openai", label: "OpenAI", count: 1, selected: false },
    ]);
  });

  it("combines author selection with capability filters and keeps facet order stable", () => {
    const catalog = [
      { ...agentModel, slug: "zeta/model-b", name: "Zeta: Model B" },
      { ...agentModel, slug: "alpha/model-a", name: "Alpha: Model A" },
      { ...agentModel, slug: "zeta/model-a", name: "Zeta: Model A" },
    ] as const;
    const input = {
      filters: new Set(["agent-ready"] as const),
      authors: new Set(["zeta"]),
      sort: "name" as const,
    };

    const forward = buildOpenRouterModelCatalogView(catalog, input);
    const reverse = buildOpenRouterModelCatalogView(catalog.toReversed(), input);

    expect(forward.models.map((model) => model.slug)).toEqual(["zeta/model-a", "zeta/model-b"]);
    expect(reverse.models.map((model) => model.slug)).toEqual(["zeta/model-a", "zeta/model-b"]);
    expect(forward.authorFacets).toEqual(reverse.authorFacets);
    expect(forward.authorFacets.map((facet) => facet.label)).toEqual(["Alpha", "Zeta"]);
    expect(forward.authorFacets.map((facet) => facet.count)).toEqual([1, 2]);
  });

  it("sorts context and price deterministically with unknown values last", () => {
    const catalog = [
      {
        ...agentModel,
        slug: "vendor/unknown",
        name: "Vendor: Unknown",
        capabilities: { ...agentModel.capabilities, contextWindow: undefined, pricing: undefined },
      },
      {
        ...agentModel,
        slug: "vendor/large-expensive",
        name: "Vendor: Large Expensive",
        capabilities: {
          ...agentModel.capabilities,
          contextWindow: { defaultTokens: 1_000_000, maxTokens: 1_000_000 },
          pricing: { promptUsdPerMillion: 10, completionUsdPerMillion: 20 },
        },
      },
      {
        ...agentModel,
        slug: "vendor/small-cheap",
        name: "Vendor: Small Cheap",
        capabilities: {
          ...agentModel.capabilities,
          contextWindow: { defaultTokens: 64_000, maxTokens: 64_000 },
          pricing: { promptUsdPerMillion: 1, completionUsdPerMillion: 2 },
        },
      },
    ] as const;

    expect(
      buildOpenRouterModelCatalogView(catalog, {
        filters: new Set(),
        sort: "context-window",
      }).models.map((model) => model.slug),
    ).toEqual(["vendor/large-expensive", "vendor/small-cheap", "vendor/unknown"]);
    expect(
      buildOpenRouterModelCatalogView(catalog, {
        filters: new Set(),
        sort: "prompt-price",
      }).models.map((model) => model.slug),
    ).toEqual(["vendor/small-cheap", "vendor/large-expensive", "vendor/unknown"]);
  });

  it("provides controlled-state defaults, reset detection, and context threshold metadata", () => {
    expect(
      isDefaultOpenRouterModelCatalogFilterState(DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE),
    ).toBe(true);
    expect(
      countActiveOpenRouterModelCatalogFilters(DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE),
    ).toBe(1);
    expect(
      countActiveOpenRouterModelCatalogFilters({
        ...DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE,
        featureFilters: new Set(["agent-ready", "vision"]),
        authors: new Set(["openai"]),
        contextThreshold: "200k",
        favoritesOnly: true,
      }),
    ).toBe(5);
    expect(OPENROUTER_MODEL_CONTEXT_THRESHOLDS).toEqual(
      expect.arrayContaining([
        { id: "32k", label: "32K+", minimumTokens: 32_000 },
        { id: "128k", label: "128K+", minimumTokens: 128_000 },
        { id: "1m", label: "1M+", minimumTokens: 1_000_000 },
      ]),
    );
  });

  it("applies the controlled context threshold in addition to quick filters", () => {
    const catalog = [
      {
        ...agentModel,
        slug: "vendor/large",
        name: "Vendor: Large",
        capabilities: {
          ...agentModel.capabilities,
          contextWindow: { defaultTokens: 200_000, maxTokens: 200_000 },
        },
      },
      {
        ...agentModel,
        slug: "vendor/small",
        name: "Vendor: Small",
        capabilities: {
          ...agentModel.capabilities,
          contextWindow: { defaultTokens: 64_000, maxTokens: 64_000 },
        },
      },
    ] as const;

    const view = buildOpenRouterModelCatalogView(catalog, {
      filters: new Set(),
      contextThreshold: "200k",
    });

    expect(view.models.map((model) => model.slug)).toEqual(["vendor/large"]);
    expect(view.matchingCount).toBe(1);
  });

  it("supports a caller-owned favorite predicate without coupling the domain to storage", () => {
    const catalog = [
      { ...agentModel, slug: "openai/favorite", name: "OpenAI: Favorite" },
      { ...agentModel, slug: "openai/other", name: "OpenAI: Other" },
    ] as const;
    const view = buildOpenRouterModelCatalogView(
      catalog,
      {
        ...DEFAULT_OPENROUTER_MODEL_CATALOG_FILTER_STATE,
        favoritesOnly: true,
      },
      { isFavorite: (model) => model.slug === "openai/favorite" },
    );

    expect(view.models.map((model) => model.slug)).toEqual(["openai/favorite"]);
    expect(view.matchingCount).toBe(1);
  });
});
