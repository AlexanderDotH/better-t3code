import { ProviderInstanceId } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";

const OPENROUTER_DRIVER = "openrouter";
const OPENROUTER_DEFAULT_INSTANCE_ID = ProviderInstanceId.make(OPENROUTER_DRIVER);
const OPENROUTER_OFFICIAL_BASE_URL = "https://openrouter.ai/api/v1";

export interface LegacyOpenRouterCredential {
  readonly instanceId: ProviderInstanceId;
  readonly apiKey: string;
}

export interface LegacyOpenRouterSettingsMigration {
  readonly settings: unknown;
  readonly credentials: readonly LegacyOpenRouterCredential[];
  readonly changed: boolean;
}

interface SanitizedOpenRouterConfig {
  readonly config: Record<string, unknown>;
  readonly apiKey: string | undefined;
  readonly changed: boolean;
}

function isOfficialOpenRouterBaseUrl(value: unknown): boolean {
  if (!Predicate.isString(value)) return false;
  const normalized = value.trim().replace(/\/+$/, "");
  return normalized.length === 0 || normalized === OPENROUTER_OFFICIAL_BASE_URL;
}

function sanitizeOpenRouterConfig(config: Record<string, unknown>): SanitizedOpenRouterConfig {
  const next = { ...config };
  const hasApiKey = Object.hasOwn(next, "apiKey");
  const hasBaseUrl = Object.hasOwn(next, "baseUrl");
  const hasCatalogLimit = Object.hasOwn(next, "preferredMaxCatalogContextTokens");
  const legacyApiKey = next.apiKey;
  const legacyBaseUrl = next.baseUrl;

  delete next.apiKey;
  delete next.baseUrl;
  delete next.preferredMaxCatalogContextTokens;

  if (hasBaseUrl && !isOfficialOpenRouterBaseUrl(legacyBaseUrl)) {
    next.legacyBaseUrlIncompatible = true;
  }
  if (!Object.hasOwn(next, "defaultModel")) {
    next.defaultModel = "";
  }

  const apiKey = Predicate.isString(legacyApiKey) ? legacyApiKey.trim() || undefined : undefined;
  return {
    config: next,
    apiKey,
    changed: hasApiKey || hasBaseUrl || hasCatalogLimit || !Object.hasOwn(config, "defaultModel"),
  };
}

function findExplicitOpenRouterInstanceIds(
  providerInstances: Record<string, unknown>,
): ProviderInstanceId[] {
  const instanceIds: ProviderInstanceId[] = [];
  for (const [instanceId, instance] of Object.entries(providerInstances)) {
    if (!Predicate.isObject(instance) || instance.driver !== OPENROUTER_DRIVER) continue;
    instanceIds.push(ProviderInstanceId.make(instanceId));
  }
  return instanceIds;
}

function legacyCredentialTarget(
  explicitInstanceIds: readonly ProviderInstanceId[],
): ProviderInstanceId {
  const defaultInstance = explicitInstanceIds.find(
    (instanceId) => instanceId === OPENROUTER_DEFAULT_INSTANCE_ID,
  );
  if (defaultInstance) return defaultInstance;
  if (explicitInstanceIds.length === 1) return explicitInstanceIds[0]!;
  return OPENROUTER_DEFAULT_INSTANCE_ID;
}

export function prepareLegacyOpenRouterSettingsMigration(
  input: unknown,
): LegacyOpenRouterSettingsMigration {
  if (!Predicate.isObject(input)) {
    return { settings: input, credentials: [], changed: false };
  }

  const settings = { ...input };
  const sourceProviderInstances = Predicate.isObject(settings.providerInstances)
    ? settings.providerInstances
    : {};
  const providerInstances: Record<string, unknown> = { ...sourceProviderInstances };
  const explicitInstanceIds = findExplicitOpenRouterInstanceIds(providerInstances);
  const credentials: LegacyOpenRouterCredential[] = [];
  let changed = false;

  for (const instanceId of explicitInstanceIds) {
    const instance = providerInstances[instanceId];
    if (!Predicate.isObject(instance) || !Predicate.isObject(instance.config)) continue;
    const sanitized = sanitizeOpenRouterConfig(instance.config);
    if (!sanitized.changed) continue;
    providerInstances[instanceId] = { ...instance, config: sanitized.config };
    if (sanitized.apiKey) {
      credentials.push({ instanceId, apiKey: sanitized.apiKey });
    }
    changed = true;
  }

  const providers = Predicate.isObject(settings.providers) ? { ...settings.providers } : {};
  const legacyProvider = providers.openrouter;
  if (Predicate.isObject(legacyProvider)) {
    const sanitized = sanitizeOpenRouterConfig(legacyProvider);
    const credentialTarget = legacyCredentialTarget(explicitInstanceIds);
    if (sanitized.apiKey) {
      credentials.push({ instanceId: credentialTarget, apiKey: sanitized.apiKey });
    }

    if (explicitInstanceIds.length === 0 && !Object.hasOwn(providerInstances, OPENROUTER_DRIVER)) {
      const { enabled, ...config } = sanitized.config;
      providerInstances[OPENROUTER_DEFAULT_INSTANCE_ID] = {
        driver: OPENROUTER_DRIVER,
        ...(Predicate.isBoolean(enabled) ? { enabled } : {}),
        config,
      };
    }

    delete providers.openrouter;
    settings.providers = providers;
    changed = true;
  }

  if (!changed) {
    return { settings: input, credentials: [], changed: false };
  }

  settings.providerInstances = providerInstances;
  return { settings, credentials, changed: true };
}
