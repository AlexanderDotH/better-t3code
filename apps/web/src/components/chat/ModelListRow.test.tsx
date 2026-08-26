import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";

import { ModelCatalogMetadata, ModelListRow } from "./ModelListRow";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";
import { Button } from "../ui/button";
import { TooltipTrigger } from "../ui/tooltip";

function flatten(node: ReactNode): ReadonlyArray<ReactNode> {
  const found: ReactNode[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    found.push(child);
    found.push(...flatten((child.props as { readonly children?: ReactNode }).children));
  }
  return found;
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (!isValidElement(node)) {
    return Children.toArray(node).map(textContent).join(" ");
  }
  return textContent((node.props as { readonly children?: ReactNode }).children);
}

function row(showProvider: boolean, subProvider?: string): ReactNode {
  return ModelListRow.type({
    index: 0,
    model: {
      slug: "gpt-5.6-luna",
      name: "GPT 5.6 Luna",
      ...(subProvider ? { subProvider } : {}),
    },
    instanceId: ProviderInstanceId.make("claudeAgent"),
    driverKind: ProviderDriverKind.make("claudeAgent"),
    providerDisplayName: "Claude GPT",
    providerAccentColor: "#f97316",
    isFavorite: false,
    isSelected: false,
    showProvider,
    onToggleFavorite: () => {},
  });
}

describe("ModelListRow provider context", () => {
  it("keeps mixed-provider results compact with an inline instance label", () => {
    const elements = flatten(row(true)).filter(isValidElement);
    const providerLabel = elements.find(
      (element) =>
        (element.props as Record<string, unknown>)["data-model-picker-provider-label"] === "inline",
    );

    expect(providerLabel).toBeDefined();
    expect(elements.some((element) => element.type === ProviderInstanceIcon)).toBe(true);
  });

  it("omits provider context for a list already scoped by the provider rail", () => {
    const elements = flatten(row(false)).filter(isValidElement);

    expect(
      elements.some(
        (element) =>
          (element.props as Record<string, unknown>)["data-model-picker-provider-label"] ===
          "inline",
      ),
    ).toBe(false);
  });

  it("keeps an upstream provider visible inside an aggregator-scoped list", () => {
    const elements = flatten(row(false, "OpenCode Go")).filter(isValidElement);
    const providerLabel = elements.find(
      (element) =>
        (element.props as Record<string, unknown>)["data-model-picker-provider-label"] === "inline",
    );

    expect(providerLabel).toBeDefined();
    expect(
      elements.some(
        (element) =>
          element.type === "span" &&
          (element.props as { readonly children?: ReactNode }).children === "OpenCode Go",
      ),
    ).toBe(true);
  });

  it("uses a dedicated metadata line for catalog rows without repeating the aggregator icon", () => {
    const elements = flatten(
      ModelListRow.type({
        index: 0,
        model: {
          slug: "openai/gpt-free-vision",
          name: "OpenAI: GPT Free Vision",
          subProvider: "OpenAI",
          capabilities: {
            contextWindow: { defaultTokens: 200_000, maxTokens: 200_000 },
            inputModalities: ["text", "image"],
            outputModalities: ["text"],
            pricing: { promptUsdPerMillion: 0, completionUsdPerMillion: 0 },
            optionDescriptors: [
              {
                id: "reasoningEffort",
                label: "Reasoning effort",
                type: "select",
                options: [{ id: "high", label: "High" }],
              },
            ],
          },
        },
        instanceId: ProviderInstanceId.make("openrouter"),
        driverKind: ProviderDriverKind.make("openrouter"),
        providerDisplayName: "OpenRouter",
        isFavorite: false,
        isSelected: false,
        showProvider: false,
        presentation: "catalog",
        onToggleFavorite: () => {},
      }),
    ).filter(isValidElement);
    const metadataElement = elements.find((element) => element.type === ModelCatalogMetadata);
    const metadata = metadataElement
      ? ModelCatalogMetadata(metadataElement.props as Parameters<typeof ModelCatalogMetadata>[0])
      : undefined;
    const metadataText = textContent(metadata).replace(/\s+/gu, " ");

    expect(metadata).toBeDefined();
    expect(
      isValidElement(metadata) &&
        (metadata.props as Record<string, unknown>)["data-model-picker-catalog-metadata"],
    ).toBe("true");
    expect(metadataText).toContain("OpenAI");
    expect(metadataText).toContain("200K context");
    expect(metadataText).toContain("Free");
    expect(metadataText).toContain("Vision");
    expect(metadataText).toContain("Reasoning");
    expect(elements.some((element) => element.type === ProviderInstanceIcon)).toBe(false);
  });

  it("keeps the favorite action available for a visible non-selectable model", () => {
    const elements = flatten(
      ModelListRow.type({
        index: 0,
        model: { slug: "openai/no-tools", name: "No tools" },
        instanceId: ProviderInstanceId.make("openrouter"),
        driverKind: ProviderDriverKind.make("openrouter"),
        providerDisplayName: "OpenRouter",
        isFavorite: false,
        isSelected: false,
        showProvider: false,
        disabledReason: "No tool support",
        onToggleFavorite: () => {},
      }),
    ).filter(isValidElement);
    const disabledRowTrigger = elements.find((element) => element.type === TooltipTrigger);
    const disabledRow = disabledRowTrigger
      ? (disabledRowTrigger.props as { readonly render?: ReactNode }).render
      : undefined;
    const favoriteTrigger = flatten(disabledRow)
      .filter(isValidElement)
      .find((element) => {
        if (element.type !== TooltipTrigger) return false;
        const render = (element.props as { readonly render?: ReactNode }).render;
        return isValidElement(render) && render.type === Button;
      });
    const favoriteButton = favoriteTrigger
      ? (favoriteTrigger.props as { readonly render?: ReactNode }).render
      : undefined;

    expect(isValidElement(favoriteButton)).toBe(true);
    if (!isValidElement(favoriteButton)) return;
    expect((favoriteButton.props as { readonly disabled?: boolean }).disabled).not.toBe(true);
    expect((favoriteButton.props as { readonly "aria-label"?: string })["aria-label"]).toBe(
      "Add No tools to favorites",
    );
  });
});
