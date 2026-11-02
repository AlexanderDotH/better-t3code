import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { setInterfaceLocaleRuntime } from "../../interfaceLanguageRuntime";
import { ModelCatalogMetadata } from "./ModelListRow";
import type { ModelEsque } from "./providerIconUtils";

it("updates translated catalog context and badges when the selected model changes", async () => {
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
  setInterfaceLocaleRuntime({ language: "de", locale: "de-DE" });
  try {
    await using screen = await render(
      <ModelCatalogMetadata model={model} providerLabel="OpenAI" />,
    );
    const labels = ["OpenAI", "200K Kontext", "Kostenlos", "Bildverarbeitung", "Reasoning"];
    for (const label of labels)
      await expect.element(screen.getByText(label, { exact: true })).toBeVisible();
    await screen.rerender(
      <ModelCatalogMetadata model={{ slug: "paid", name: "Paid" }} providerLabel="Other" />,
    );
    await expect.element(screen.getByText("Other", { exact: true })).toBeVisible();
    for (const label of labels)
      await expect.element(screen.getByText(label, { exact: true })).not.toBeInTheDocument();
  } finally {
    setInterfaceLocaleRuntime({ language: "en", locale: "en-US" });
  }
});
