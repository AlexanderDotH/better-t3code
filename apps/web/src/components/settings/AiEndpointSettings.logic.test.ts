import {
  LM_STUDIO_BASE_URL,
  ProviderDriverKind,
  type AiEndpointCandidate,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  adoptAiEndpoint,
  aiEndpointBaseUrl,
  aiEndpointBaseUrlError,
  normalizedConfiguredUrls,
} from "./AiEndpointSettings.logic";

const compatible = ProviderDriverKind.make("openaiCompatible");
const lmstudio = ProviderDriverKind.make("lmstudio");
const endpoint: AiEndpointCandidate = {
  baseUrl: "http://192.168.1.20:1234/v1",
  kind: "lmstudio",
  verified: true,
  requiresApiKey: false,
  models: [{ id: "local-model" }],
};

describe("AI endpoint setup", () => {
  it("requires a compatible URL and offers an editable LM Studio default", () => {
    expect(aiEndpointBaseUrlError(compatible, {})).toBe(
      "settings.providers.endpoint.baseUrlRequired",
    );
    expect(aiEndpointBaseUrl(lmstudio, {})).toBe(LM_STUDIO_BASE_URL);
    expect(aiEndpointBaseUrl(lmstudio, { baseUrl: "https://models.example/proxy/v1/" })).toBe(
      "https://models.example/proxy/v1",
    );
    expect(aiEndpointBaseUrlError(lmstudio, { baseUrl: "" })).toBe(
      "settings.providers.endpoint.baseUrlRequired",
    );
    expect(aiEndpointBaseUrlError(compatible, { baseUrl: "https://key@models.example" })).toBe(
      "settings.providers.endpoint.baseUrlInvalid",
    );
  });

  it("adopts an endpoint without replacing manual models or unrelated options", () => {
    const existing = {
      baseUrl: "http://old.example/v1",
      defaultModel: "manual-model",
      customModels: ["other-model"],
      forkOption: true,
    };
    expect(adoptAiEndpoint(existing, endpoint)).toEqual({ ...existing, baseUrl: endpoint.baseUrl });
    expect(existing.baseUrl).toBe("http://old.example/v1");
    expect(adoptAiEndpoint({}, endpoint)).toEqual({
      baseUrl: endpoint.baseUrl,
      defaultModel: "local-model",
    });
    expect(
      adoptAiEndpoint(undefined, {
        ...endpoint,
        models: [],
        verified: false,
        requiresApiKey: true,
      }),
    ).toEqual({ baseUrl: endpoint.baseUrl, defaultModel: "" });
  });

  it("marks equivalent configured addresses across drivers without losing disabled or default instances", () => {
    expect(
      normalizedConfiguredUrls({
        defaultStudio: { driver: lmstudio },
        remote: {
          driver: compatible,
          enabled: false,
          config: { baseUrl: "http://192.168.1.20:1234/" },
        },
        duplicate: { driver: lmstudio, config: { baseUrl: endpoint.baseUrl } },
        invalid: { driver: compatible, config: { baseUrl: "not a URL" } },
        unrelated: {
          driver: ProviderDriverKind.make("openai"),
          config: { baseUrl: "https://other.example/v1" },
        },
      }),
    ).toEqual(new Set([LM_STUDIO_BASE_URL, endpoint.baseUrl]));
  });
});
