import {
  LM_STUDIO_BASE_URL,
  normalizeAiEndpointBaseUrl,
  type AiEndpointCandidate,
  type ProviderDriverKind,
  type ProviderInstanceConfig,
} from "@t3tools/contracts";
import { readProviderConfigString } from "@t3tools/client-runtime/providerSettingsForm";

export function isAiEndpointDriver(driver: ProviderDriverKind): boolean {
  return driver === "openaiCompatible" || driver === "lmstudio";
}

export function aiEndpointBaseUrl(driver: ProviderDriverKind, config: unknown): string | null {
  try {
    return normalizeAiEndpointBaseUrl(
      readProviderConfigString(config, "baseUrl", driver === "lmstudio" ? LM_STUDIO_BASE_URL : ""),
    );
  } catch {
    return null;
  }
}

export function aiEndpointBaseUrlError(driver: ProviderDriverKind, config: unknown) {
  const baseUrl = aiEndpointBaseUrl(driver, config);
  return baseUrl === null
    ? ("settings.providers.endpoint.baseUrlInvalid" as const)
    : baseUrl === ""
      ? ("settings.providers.endpoint.baseUrlRequired" as const)
      : null;
}

export function adoptAiEndpoint(config: unknown, endpoint: AiEndpointCandidate) {
  return {
    ...(config !== null && typeof config === "object" ? config : {}),
    baseUrl: endpoint.baseUrl,
    defaultModel: readProviderConfigString(config, "defaultModel") || endpoint.models[0]?.id || "",
  };
}

export function normalizedConfiguredUrls(
  instances: Readonly<Record<string, ProviderInstanceConfig>>,
) {
  const urls = new Set<string>();
  for (const instance of Object.values(instances)) {
    if (!isAiEndpointDriver(instance.driver)) continue;
    const baseUrl = aiEndpointBaseUrl(instance.driver, instance.config);
    if (baseUrl) urls.add(baseUrl);
  }
  return urls;
}
