import {
  planInterfaceLanguageSync,
  type InterfaceLanguageSyncPlan,
} from "@t3tools/client-runtime/interface-language-sync";
import type { InterfaceLanguagePreference, InterfaceLanguageSyncRecord } from "@t3tools/contracts";

import {
  mobileInterfaceLanguagePreferencePatch,
  resolveMobileInterfaceLanguagePreference,
  type MobileInterfaceLanguagePreferencePatch,
} from "./interface-language-preference";

export interface MobileInterfaceLanguageSyncEnvironment<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly configLoaded: boolean;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly record: InterfaceLanguageSyncRecord | null;
}

export interface MobileInterfaceLanguageSyncResult<EnvironmentId extends string = string> {
  readonly isReady: boolean;
  readonly preference: InterfaceLanguagePreference;
  readonly preferencePatch: MobileInterfaceLanguagePreferencePatch | null;
  readonly plan: InterfaceLanguageSyncPlan<EnvironmentId>;
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
}

function recordsMatch(
  left: InterfaceLanguageSyncRecord | undefined,
  right: InterfaceLanguageSyncRecord,
): boolean {
  return (
    left?.preference === right.preference &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId
  );
}

function labelsFor<EnvironmentId extends string>(
  environmentIds: readonly EnvironmentId[],
  labelByEnvironmentId: ReadonlyMap<EnvironmentId, string>,
): readonly string[] {
  return environmentIds.map(
    (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
  );
}

export function deriveMobileInterfaceLanguageSync<EnvironmentId extends string = string>(input: {
  readonly preferencesReady: boolean;
  readonly catalogReady: boolean;
  readonly localRecord: InterfaceLanguageSyncRecord | undefined;
  readonly environments: readonly MobileInterfaceLanguageSyncEnvironment<EnvironmentId>[];
}): MobileInterfaceLanguageSyncResult<EnvironmentId> {
  const configuredEnvironments = input.environments.filter(
    (environment) => environment.configLoaded,
  );
  const plan = planInterfaceLanguageSync({
    localRecord: input.localRecord ?? null,
    environments: configuredEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      environmentSettingsVersion: environment.environmentSettingsVersion,
      connected: environment.connected,
      record: environment.record,
    })),
  });
  const isReady =
    input.preferencesReady &&
    input.catalogReady &&
    input.environments.every((environment) => !environment.connected || environment.configLoaded);
  const preferencePatch =
    isReady && plan.winner !== null && !recordsMatch(input.localRecord, plan.winner)
      ? mobileInterfaceLanguagePreferencePatch(plan.winner)
      : null;
  const labelByEnvironmentId = new Map(
    input.environments.map(
      (environment) => [environment.environmentId, environment.label] as const,
    ),
  );

  return {
    isReady,
    preference: resolveMobileInterfaceLanguagePreference(
      input.preferencesReady ? (plan.winner ?? input.localRecord) : undefined,
    ),
    preferencePatch,
    plan,
    unsupportedEnvironmentLabels: labelsFor(plan.unsupportedEnvironmentIds, labelByEnvironmentId),
    deferredEnvironmentLabels: labelsFor(plan.deferredEnvironmentIds, labelByEnvironmentId),
  };
}
