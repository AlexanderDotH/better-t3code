import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceId, type ProviderOptionSelection } from "@t3tools/contracts";

import type { ModelOption } from "../../lib/modelOptions";
import {
  filterOpenRouterProviderCatalog,
  modelMatchesCatalogQuery,
  pendingModelAfterPress,
  providerCatalogUsesDrillIn,
} from "./thread-settings-sheet-state";

function modelOption(
  model: string,
  options: ReadonlyArray<ProviderOptionSelection> = [],
): ModelOption {
  return {
    key: `codex:${model}`,
    label: model,
    subtitle: "Codex",
    providerKey: "codex",
    providerLabel: "Codex",
    providerDriver: "codex",
    isDefault: false,
    isLegacy: false,
    isSelectable: true,
    unavailableReason: null,
    continuationGroupKey: null,
    requiresNewThreadForModelChange: false,
    capabilities: null,
    selection: {
      instanceId: ProviderInstanceId.make("codex"),
      model,
      options,
    },
  };
}

describe("thread settings sheet state", () => {
  it("opens OpenRouter in a provider-specific catalog while keeping other providers inline", () => {
    expect(providerCatalogUsesDrillIn("openrouter")).toBe(true);
    expect(providerCatalogUsesDrillIn("codex")).toBe(false);
    expect(providerCatalogUsesDrillIn(undefined)).toBe(false);
  });

  it("filters the OpenRouter drill-in catalog by capabilities, search, and favorites", () => {
    const freeVisionModel: ModelOption = {
      ...modelOption("openai/free-vision"),
      providerDriver: "openrouter",
      capabilities: {
        contextWindow: { defaultTokens: 128_000, maxTokens: 128_000 },
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        pricing: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
        toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
      },
    };
    const paidTextModel: ModelOption = {
      ...modelOption("anthropic/paid-text"),
      providerDriver: "openrouter",
      capabilities: {
        contextWindow: { defaultTokens: 64_000, maxTokens: 64_000 },
        inputModalities: ["text"],
        outputModalities: ["text"],
        pricing: { promptUsdPerMillion: 1, completionUsdPerMillion: 2 },
        toolSupport: { tools: true, parallelToolCalls: true, toolChoice: true },
      },
    };

    expect(
      filterOpenRouterProviderCatalog({
        models: [paidTextModel, freeVisionModel],
        providerLabel: "OpenRouter",
        query: "free",
        filters: new Set(["free", "vision"]),
        favoritesOnly: true,
        isFavorite: (model) => model.selection.model === freeVisionModel.selection.model,
      }),
    ).toEqual([freeVisionModel]);
    expect(
      filterOpenRouterProviderCatalog({
        models: [paidTextModel, freeVisionModel],
        providerLabel: "OpenRouter",
        query: "",
        filters: new Set(["free"]),
        favoritesOnly: true,
        isFavorite: () => false,
      }),
    ).toEqual([]);
  });

  it("matches visible model and provider terms", () => {
    const model = modelOption("gpt-next");

    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "NEXT" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "codex" })).toBe(true);
    expect(modelMatchesCatalogQuery({ model, providerLabel: "Codex", query: "claude" })).toBe(
      false,
    );
  });

  it("treats whitespace-only catalog searches as empty", () => {
    expect(
      modelMatchesCatalogQuery({
        model: modelOption("gpt-next"),
        providerLabel: "Codex",
        query: "   ",
      }),
    ).toBe(true);
  });

  it("clears staging when the applied model is pressed", () => {
    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed: modelOption("gpt-current"),
        pressedIsApplied: true,
      }),
    ).toBeNull();
  });

  it("preserves staged options when the highlighted model is pressed again", () => {
    const pending = modelOption("gpt-next", [{ id: "effort", value: "high" }]);

    expect(
      pendingModelAfterPress({
        current: pending,
        pressed: modelOption("gpt-next"),
        pressedIsApplied: false,
      }),
    ).toBe(pending);
  });

  it("stages a different model", () => {
    const pressed = modelOption("gpt-other");

    expect(
      pendingModelAfterPress({
        current: modelOption("gpt-next"),
        pressed,
        pressedIsApplied: false,
      }),
    ).toBe(pressed);
  });
});
