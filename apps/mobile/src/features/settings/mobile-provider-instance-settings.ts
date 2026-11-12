import {
  ProviderInstanceEnvironmentVariableName,
  defaultInstanceIdForDriver,
  isSecretReference,
  type ProviderInstanceConfig,
  type ProviderInstanceEnvironmentVariable,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerSettings,
  type ServerSettingsPatch,
  SecretReference,
} from "@t3tools/contracts";
import { normalizeProviderAccentColor } from "@t3tools/client-runtime/state/provider-instance-display";
import * as Schema from "effect/Schema";

const isProviderEnvironmentVariableName = Schema.is(ProviderInstanceEnvironmentVariableName);
const isProviderSecretReference = Schema.is(SecretReference);

export interface MobileProviderVariableDraft {
  readonly name: string;
  readonly value: string | SecretReference;
  readonly sensitive: boolean;
  readonly valueRedacted?: boolean;
}

export function buildMobileProviderInstance(
  instance: ProviderInstanceConfig,
  patch: Partial<ProviderInstanceConfig>,
): ProviderInstanceConfig {
  const next = { ...instance, ...patch };
  return {
    ...next,
    displayName: next.displayName?.trim() || undefined,
    accentColor: normalizeProviderAccentColor(next.accentColor),
  };
}

export function mobileProviderInstanceFor(
  settings: ServerSettings,
  provider: Pick<
    ServerProvider,
    "instanceId" | "driver" | "enabled" | "displayName" | "accentColor"
  >,
): ProviderInstanceConfig {
  const explicit = settings.providerInstances[provider.instanceId];
  if (explicit) return explicit;
  const legacy =
    provider.instanceId === defaultInstanceIdForDriver(provider.driver)
      ? Object.entries(settings.providers).find(([driver]) => driver === provider.driver)?.[1]
      : undefined;
  return {
    driver: provider.driver,
    enabled: provider.enabled,
    displayName: provider.displayName,
    accentColor: provider.accentColor,
    ...(legacy === undefined ? {} : { config: legacy }),
  };
}

export function editMobileProviderVariable(
  variable: MobileProviderVariableDraft,
  patch: Partial<MobileProviderVariableDraft>,
): MobileProviderVariableDraft | null {
  if (
    variable.valueRedacted &&
    patch.value === undefined &&
    ((patch.name !== undefined && patch.name !== variable.name) ||
      (patch.sensitive !== undefined && patch.sensitive !== variable.sensitive))
  )
    return null;
  return {
    ...variable,
    ...patch,
    ...(patch.value === undefined ? {} : { valueRedacted: false }),
    ...(isSecretReference(patch.value) ? { sensitive: true } : {}),
  };
}

export function serializeMobileProviderEnvironment(
  variables: ReadonlyArray<MobileProviderVariableDraft>,
): ReadonlyArray<ProviderInstanceEnvironmentVariable> | null {
  const environment: ProviderInstanceEnvironmentVariable[] = [];
  const seen = new Set<string>();
  for (const variable of variables) {
    const name = variable.name.trim();
    if (!name && variable.value === "" && !variable.valueRedacted) continue;
    if (
      !isProviderEnvironmentVariableName(name) ||
      seen.has(name) ||
      (typeof variable.value !== "string" && !isProviderSecretReference(variable.value))
    )
      return null;
    seen.add(name);
    environment.push({ ...variable, name: ProviderInstanceEnvironmentVariableName.make(name) });
  }
  return environment;
}

export function orderedMobileProviderModels(
  slugs: ReadonlyArray<string>,
  order: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const available = new Set(slugs);
  return [...new Set([...order.filter((slug) => available.has(slug)), ...slugs, ...order])];
}

export function mobileProviderModelPreferencesPatch(
  settings: Pick<ServerSettings, "providerModelPreferences">,
  instanceId: ProviderInstanceId,
  change: Partial<NonNullable<ServerSettings["providerModelPreferences"]>[ProviderInstanceId]>,
): ServerSettingsPatch {
  return {
    providerModelPreferences: {
      ...settings.providerModelPreferences,
      [instanceId]: {
        hiddenModels: [],
        modelOrder: [],
        ...settings.providerModelPreferences?.[instanceId],
        ...change,
      },
    },
  };
}

export function moveMobileProviderModel(
  slugs: ReadonlyArray<string>,
  order: ReadonlyArray<string>,
  slug: string,
  direction: -1 | 1,
): ReadonlyArray<string> {
  const next = [...orderedMobileProviderModels(slugs, order)];
  const index = next.indexOf(slug);
  const destination = index + direction;
  if (index < 0 || destination < 0 || destination >= slugs.length) return next;
  [next[index], next[destination]] = [next[destination]!, next[index]!];
  return next;
}
