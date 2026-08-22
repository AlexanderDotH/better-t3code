import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it } from "vite-plus/test";

import { ModelListRow } from "./ModelListRow";
import { ProviderInstanceIcon } from "./ProviderInstanceIcon";

function flatten(node: ReactNode): ReadonlyArray<ReactNode> {
  const found: ReactNode[] = [];
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    found.push(child);
    found.push(...flatten((child.props as { readonly children?: ReactNode }).children));
  }
  return found;
}

function row(showProvider: boolean): ReactNode {
  return ModelListRow.type({
    index: 0,
    model: { slug: "gpt-5.6-luna", name: "GPT 5.6 Luna" },
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
});
