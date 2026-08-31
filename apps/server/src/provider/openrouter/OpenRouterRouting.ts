import type { OpenRouterSettings } from "@t3tools/contracts";

export interface OpenRouterProviderPreferences {
  readonly require_parameters: true;
  readonly order?: ReadonlyArray<string>;
  readonly sort?: OpenRouterSettings["routingSort"];
  readonly allow_fallbacks?: boolean;
  readonly data_collection?: "allow" | "deny";
  readonly zdr?: true;
  readonly preferred_min_throughput?: number;
  readonly preferred_max_latency?: number;
  readonly max_price?: {
    readonly prompt?: number;
    readonly completion?: number;
    readonly request?: number;
  };
}

export interface OpenRouterRequestPolicy {
  readonly provider: OpenRouterProviderPreferences;
  readonly plugins: ReadonlyArray<{
    readonly id: "context-compression";
    readonly enabled: boolean;
  }>;
}

const uniqueProviderOrder = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>();
  const result: Array<string> = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
};

const maxPrice = (settings: OpenRouterSettings): OpenRouterProviderPreferences["max_price"] => {
  const value = {
    ...(settings.maxPromptPriceUsdPerMillion === undefined
      ? {}
      : { prompt: settings.maxPromptPriceUsdPerMillion }),
    ...(settings.maxCompletionPriceUsdPerMillion === undefined
      ? {}
      : { completion: settings.maxCompletionPriceUsdPerMillion }),
    ...(settings.maxRequestPriceUsd === undefined ? {} : { request: settings.maxRequestPriceUsd }),
  };
  return Object.keys(value).length === 0 ? undefined : value;
};

export const buildOpenRouterRequestPolicy = (
  settings: OpenRouterSettings,
): OpenRouterRequestPolicy => {
  const order = uniqueProviderOrder(settings.providerOrder);
  const price = maxPrice(settings);
  const provider: OpenRouterProviderPreferences = {
    require_parameters: true,
    ...(settings.routingMode === "provider-order" && order.length > 0 ? { order } : {}),
    ...(settings.routingMode === "sort" ? { sort: settings.routingSort } : {}),
    ...(settings.allowFallbacks === "inherit"
      ? {}
      : { allow_fallbacks: settings.allowFallbacks === "enabled" }),
    ...(settings.dataCollection === "inherit" ? {} : { data_collection: settings.dataCollection }),
    ...(settings.requireZdr ? { zdr: true } : {}),
    ...(settings.preferredMinThroughput === undefined
      ? {}
      : { preferred_min_throughput: settings.preferredMinThroughput }),
    ...(settings.preferredMaxLatency === undefined
      ? {}
      : { preferred_max_latency: settings.preferredMaxLatency }),
    ...(price === undefined ? {} : { max_price: price }),
  };
  return {
    provider,
    plugins: [{ id: "context-compression", enabled: settings.contextCompression }],
  };
};
