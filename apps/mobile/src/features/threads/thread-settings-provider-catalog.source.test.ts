import * as NodeFS from "node:fs";

import { describe, expect, it } from "vite-plus/test";

const source = NodeFS.readFileSync(new URL("./ThreadSettingsSheet.tsx", import.meta.url), "utf8");

describe("mobile provider-specific model catalog", () => {
  it("pushes OpenRouter into its own virtualized picker page", () => {
    expect(source).toContain("ThreadSettingsProviderCatalog:");
    expect(source).toContain("ThreadSettingsProviderCatalogScreen");
    expect(source).toContain("OpenRouterCatalogFilterControls");
    expect(source).toContain("filterOpenRouterProviderCatalog");
    expect(source).toContain("recycleItems");
  });

  it("keeps OpenRouter filters out of the main thread settings filter menu", () => {
    const mainScreen = source.slice(
      source.indexOf("function ThreadSettingsModelsScreen()"),
      source.indexOf("function ThreadSettingsProviderCatalogScreen()"),
    );

    expect(mainScreen).not.toContain('title: "OpenRouter"');
    expect(mainScreen).not.toContain("OPENROUTER_FILTER_LABELS.map");
  });

  it("gives filter chips a 44px touch target", () => {
    const filterChip = source.slice(
      source.indexOf("function CatalogFilterChip("),
      source.indexOf("function OpenRouterCatalogFilterControls("),
    );

    expect(filterChip).toContain("min-h-11");
  });

  it("announces the model-specific favorite action without selecting the row", () => {
    const modelRow = source.slice(
      source.indexOf("function ModelRow("),
      source.indexOf("function ProviderHeader("),
    );

    expect(modelRow).toContain("event.stopPropagation()");
    expect(modelRow).toContain("`Remove ${props.option.label} from favorites`");
    expect(modelRow).toContain("`Add ${props.option.label} to favorites`");
  });
});
