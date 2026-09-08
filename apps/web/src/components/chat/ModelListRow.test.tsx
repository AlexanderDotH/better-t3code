import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it, vi } from "vite-plus/test";

import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { ModelCatalogMetadata } from "./ModelListRow";
import type { ModelEsque } from "./providerIconUtils";

describe("OpenRouter catalog metadata", () => {
  it("updates translated context and badges when the catalog model changes", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const model: ModelEsque = {
      slug: "openai/free-vision",
      name: "Free Vision",
      capabilities: {
        contextWindow: { defaultTokens: 200_000, maxTokens: 200_000 },
        inputModalities: ["text", "image"],
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
    };
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
        renderer = create(<ModelCatalogMetadata model={model} providerLabel="OpenAI" />);
      });
      const metadata = JSON.stringify(renderer!.toJSON());
      for (const label of [
        "OpenAI",
        "200K Kontext",
        "Kostenlos",
        "Bildverarbeitung",
        "Reasoning",
      ]) {
        expect(metadata).toContain(label);
      }

      await act(() => {
        renderer!.update(
          <ModelCatalogMetadata model={{ slug: "paid", name: "Paid" }} providerLabel="Other" />,
        );
      });
      const updatedMetadata = JSON.stringify(renderer!.toJSON());
      expect(updatedMetadata).toContain("Other");
      for (const label of [
        "OpenAI",
        "200K Kontext",
        "Kostenlos",
        "Bildverarbeitung",
        "Reasoning",
      ]) {
        expect(updatedMetadata).not.toContain(label);
      }
    } finally {
      await act(() => {
        renderer?.unmount();
        setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
      });
      vi.unstubAllGlobals();
    }
  });
});
