import { BetterT3SettingsV1, bootstrapBetterT3SettingsV1 } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const isBetterT3SettingsV1 = Schema.is(BetterT3SettingsV1);

function readExplicitLegacyDeepThinkingEnabled(
  settings: Readonly<Record<string, unknown>>,
): boolean | undefined {
  const agentEnhancement = settings.agentEnhancement;
  if (
    agentEnhancement === null ||
    typeof agentEnhancement !== "object" ||
    Array.isArray(agentEnhancement)
  ) {
    return undefined;
  }
  const deepThinking = (agentEnhancement as Record<string, unknown>).deepThinking;
  if (deepThinking === null || typeof deepThinking !== "object" || Array.isArray(deepThinking)) {
    return undefined;
  }
  const enabled = (deepThinking as Record<string, unknown>).enabled;
  return typeof enabled === "boolean" ? enabled : undefined;
}

function normalizeBetterT3Compatibility(settings: Readonly<Record<string, unknown>>): unknown {
  const persisted = settings.betterT3Environment;
  if (Object.hasOwn(settings, "betterT3Environment") && !isBetterT3SettingsV1(persisted)) {
    return persisted;
  }
  const legacyDeepThinkingEnabled = readExplicitLegacyDeepThinkingEnabled(settings);
  return bootstrapBetterT3SettingsV1({
    version: 1,
    initialization: "existing-install-migration",
    persistedSettings: isBetterT3SettingsV1(persisted) ? persisted : null,
    compatibilityFlags:
      legacyDeepThinkingEnabled === undefined
        ? []
        : [{ featureId: "agent.deepThinking", enabled: legacyDeepThinkingEnabled }],
  });
}

function needsDeepThinkingCompatibilityWrite(settings: Readonly<Record<string, unknown>>): boolean {
  if (readExplicitLegacyDeepThinkingEnabled(settings) === undefined) return false;
  const persisted = settings.betterT3Environment;
  return isBetterT3SettingsV1(persisted) && !Object.hasOwn(persisted.flags, "agent.deepThinking");
}

export function normalizePersistedSettingsCompatibility(input: unknown): unknown {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return input;
  }

  const settings = input as Record<string, unknown>;
  const { enableAssistantStreaming, enableLegacyTokenStreaming, ...canonicalSettings } = settings;
  const nextSettings: Record<string, unknown> = {
    ...canonicalSettings,
    betterT3Environment: normalizeBetterT3Compatibility(settings),
  };
  const legacyLocale = settings.interfaceLanguageSyncRecord;
  if (
    !Object.hasOwn(settings, "interfaceLocaleSyncRecordV1") &&
    legacyLocale !== null &&
    typeof legacyLocale === "object" &&
    !Array.isArray(legacyLocale)
  ) {
    nextSettings.interfaceLocaleSyncRecordV1 = { version: 1, ...legacyLocale };
  }
  if (!Object.hasOwn(settings, "responseStreamingMode")) {
    const legacyStreaming =
      typeof enableLegacyTokenStreaming === "boolean"
        ? enableLegacyTokenStreaming
        : enableAssistantStreaming;
    if (typeof legacyStreaming === "boolean") {
      nextSettings.responseStreamingMode = legacyStreaming ? "token" : "turn";
    }
  }
  return nextSettings;
}

export function persistedSettingsNeedsCompatibilityWrite(input: unknown): boolean {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false;
  const settings = input as Record<string, unknown>;
  return (
    !Object.hasOwn(settings, "betterT3Environment") ||
    needsDeepThinkingCompatibilityWrite(settings) ||
    (Object.hasOwn(settings, "interfaceLanguageSyncRecord") &&
      !Object.hasOwn(settings, "interfaceLocaleSyncRecordV1")) ||
    Object.hasOwn(settings, "enableAssistantStreaming") ||
    Object.hasOwn(settings, "enableLegacyTokenStreaming")
  );
}
