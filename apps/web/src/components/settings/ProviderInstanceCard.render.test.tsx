import {
  EnvironmentId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ProviderInstanceCard } from "./ProviderInstanceCard";
import { DRIVER_OPTION_BY_VALUE } from "./providerDriverMeta";

const environmentId = EnvironmentId.make("settings-test");

function renderProviderCard(driver: "codex" | "openrouter", config: unknown): string {
  const driverKind = ProviderDriverKind.make(driver);
  const instanceId = ProviderInstanceId.make(driver);
  const instance: ProviderInstanceConfig = {
    driver: driverKind,
    enabled: true,
    config,
  };

  return renderToStaticMarkup(
    <ProviderInstanceCard
      environmentId={environmentId}
      instanceId={instanceId}
      instance={instance}
      driverOption={DRIVER_OPTION_BY_VALUE[driverKind]}
      liveProvider={undefined}
      providerAuthFlow="browser"
      readOnly={false}
      mode="editor"
      onUpdate={() => undefined}
      hiddenModels={[]}
      favoriteModels={[]}
      modelOrder={[]}
      onHiddenModelsChange={() => undefined}
      onFavoriteModelsChange={() => undefined}
      onModelOrderChange={() => undefined}
    />,
  );
}

describe("ProviderInstanceCard model settings", () => {
  it("keeps OpenRouter configuration without rendering its catalog manager", () => {
    const markup = renderProviderCard("openrouter", {
      defaultModel: "openai/gpt-5",
      customModels: ["@preset/t3"],
    });

    expect(markup).toContain("Protocol");
    expect(markup).toContain("Default model");
    expect(markup).toContain("Custom models and presets");
    expect(markup).toContain("Routing mode");
    expect(markup).toContain("Endpoint fallbacks");
    expect(markup).toContain("Data collection");
    expect(markup).toContain("Maximum prompt price");
    expect(markup).not.toContain("1 model available.");
    expect(markup).not.toContain("Add @preset/t3 to favorites");
    expect(markup).toContain("lg:flex lg:h-full lg:min-h-0 lg:flex-col");
  });

  it("preserves the catalog manager for non-OpenRouter providers", () => {
    const markup = renderProviderCard("codex", { customModels: ["custom/codex"] });

    expect(markup).toContain("1 model available.");
    expect(markup).toContain("Add custom/codex to favorites");
  });
});
