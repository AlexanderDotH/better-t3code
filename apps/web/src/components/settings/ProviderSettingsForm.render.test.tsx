import { OpenRouterSettings, ProviderDriverKind } from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderSettingsForm } from "./ProviderSettingsForm";

const definition = {
  value: ProviderDriverKind.make("openrouter"),
  label: "OpenRouter",
  icon: () => null,
  settingsSchema: OpenRouterSettings,
};

describe("ProviderSettingsForm", () => {
  it("renders model-backed OpenRouter settings from the live instance catalog", () => {
    const loadingMarkup = renderToStaticMarkup(
      <ProviderSettingsForm
        definition={definition}
        value={{}}
        idPrefix="openrouter"
        variant="card"
        onChange={() => undefined}
      />,
    );
    expect(loadingMarkup).toContain("Loading options");
    expect(loadingMarkup).not.toContain("Provider order</span>");

    const loadedMarkup = renderToStaticMarkup(
      <ProviderSettingsForm
        definition={definition}
        value={{ defaultModel: "openai/gpt-5", routingMode: "provider-order" }}
        models={[{ slug: "openai/gpt-5", name: "GPT-5" }]}
        idPrefix="openrouter"
        variant="card"
        onChange={() => undefined}
      />,
    );
    expect(loadedMarkup).toContain("GPT-5");
    expect(loadedMarkup).toContain("Provider order");
    expect(loadedMarkup).toContain("Preferred minimum throughput");
  });
});
