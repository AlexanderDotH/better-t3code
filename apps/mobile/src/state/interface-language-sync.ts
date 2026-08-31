import {
  planInterfaceLocaleCompatibilitySync,
  settleInterfaceLanguageSyncWrites,
  settleInterfaceLocaleSyncWrites,
  type InterfaceLanguageSyncWrite,
  type InterfaceLanguageSyncWriteOutcome,
  type InterfaceLocaleCompatibilitySyncPlan,
  type InterfaceLocaleSyncWrite,
  type InterfaceLocaleSyncWriteOutcome,
} from "@t3tools/client-runtime/interface-language-sync";
import type {
  InterfaceLanguageSyncRecord,
  InterfaceLocalePreferenceV1,
  InterfaceLocaleSyncRecordV1,
} from "@t3tools/contracts";

import {
  mobileInterfaceLocalePreferencePatch,
  resolveMobileInterfaceLocalePreference,
  type MobileInterfaceLocalePreferencePatch,
} from "./interface-language-preference";

export interface MobileInterfaceLanguageSyncEnvironment<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly configLoaded: boolean;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly localeRecord: InterfaceLocaleSyncRecordV1 | null;
  readonly legacyRecord: InterfaceLanguageSyncRecord | null;
}

export interface MobileInterfaceLanguageSyncResult<EnvironmentId extends string = string> {
  readonly isReady: boolean;
  readonly preference: InterfaceLocalePreferenceV1;
  readonly preferencePatch: MobileInterfaceLocalePreferencePatch | null;
  readonly plan: InterfaceLocaleCompatibilitySyncPlan<EnvironmentId>;
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
}

export type MobileInterfaceLanguageSyncWrite<EnvironmentId extends string = string> =
  | ({ readonly kind: "locale" } & InterfaceLocaleSyncWrite<EnvironmentId>)
  | ({ readonly kind: "legacy" } & InterfaceLanguageSyncWrite<EnvironmentId>);

export type MobileInterfaceLanguageSyncWriteOutcome<EnvironmentId extends string = string> =
  | ({ readonly kind: "locale" } & InterfaceLocaleSyncWriteOutcome<EnvironmentId>)
  | ({ readonly kind: "legacy" } & InterfaceLanguageSyncWriteOutcome<EnvironmentId>);

export function mobileInterfaceLanguageSyncWrites<EnvironmentId extends string = string>(
  plan: InterfaceLocaleCompatibilitySyncPlan<EnvironmentId>,
): readonly MobileInterfaceLanguageSyncWrite<EnvironmentId>[] {
  return [
    ...plan.localePlan.writes.map((write) => ({ kind: "locale" as const, ...write })),
    ...plan.legacyPlan.writes.map((write) => ({ kind: "legacy" as const, ...write })),
  ];
}

export function settleMobileInterfaceLanguageSyncWrites<EnvironmentId extends string = string>(
  plan: InterfaceLocaleCompatibilitySyncPlan<EnvironmentId>,
  outcomes: readonly MobileInterfaceLanguageSyncWriteOutcome<EnvironmentId>[],
): {
  readonly successfulEnvironmentIds: readonly EnvironmentId[];
  readonly failedEnvironmentIds: readonly EnvironmentId[];
} {
  const locale = settleInterfaceLocaleSyncWrites(
    plan.localePlan,
    outcomes.filter(
      (
        outcome,
      ): outcome is Extract<
        MobileInterfaceLanguageSyncWriteOutcome<EnvironmentId>,
        { readonly kind: "locale" }
      > => outcome.kind === "locale",
    ),
  );
  const legacy = settleInterfaceLanguageSyncWrites(
    plan.legacyPlan,
    outcomes.filter(
      (
        outcome,
      ): outcome is Extract<
        MobileInterfaceLanguageSyncWriteOutcome<EnvironmentId>,
        { readonly kind: "legacy" }
      > => outcome.kind === "legacy",
    ),
  );
  return {
    successfulEnvironmentIds: [
      ...locale.successfulEnvironmentIds,
      ...legacy.successfulEnvironmentIds,
    ],
    failedEnvironmentIds: [...locale.failedEnvironmentIds, ...legacy.failedEnvironmentIds],
  };
}

function recordsMatch(
  left: InterfaceLocaleSyncRecordV1 | undefined,
  right: InterfaceLocaleSyncRecordV1,
): boolean {
  return (
    left?.version === right.version &&
    left.preference === right.preference &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId
  );
}

function legacyRecordsMatch(
  left: InterfaceLanguageSyncRecord | null,
  right: InterfaceLanguageSyncRecord | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.preference === right.preference &&
      left.updatedAt === right.updatedAt &&
      left.updateId === right.updateId)
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
  readonly localLocaleRecord: InterfaceLocaleSyncRecordV1 | undefined;
  readonly localLegacyRecord: InterfaceLanguageSyncRecord | null;
  readonly environments: readonly MobileInterfaceLanguageSyncEnvironment<EnvironmentId>[];
}): MobileInterfaceLanguageSyncResult<EnvironmentId> {
  const configuredEnvironments = input.environments.filter(
    (environment) => environment.configLoaded,
  );
  const plan = planInterfaceLocaleCompatibilitySync({
    localLocaleRecord: input.localLocaleRecord ?? null,
    localLegacyRecord: input.localLegacyRecord,
    environments: configuredEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      environmentSettingsVersion: environment.environmentSettingsVersion,
      connected: environment.connected,
      localeRecord: environment.localeRecord,
      legacyRecord: environment.legacyRecord,
    })),
  });
  const isReady =
    input.preferencesReady &&
    input.catalogReady &&
    input.environments.every((environment) => !environment.connected || environment.configLoaded);
  const winner = plan.winner;
  const legacyMirror = plan.nextLocalLegacyRecord;
  const localeRecordChanged = winner !== null && !recordsMatch(input.localLocaleRecord, winner);
  const legacyRecordChanged =
    legacyMirror !== null && !legacyRecordsMatch(input.localLegacyRecord, legacyMirror);
  const preferencePatch =
    isReady && winner !== null && (localeRecordChanged || legacyRecordChanged)
      ? mobileInterfaceLocalePreferencePatch(winner, legacyRecordChanged ? legacyMirror : undefined)
      : null;
  const labelByEnvironmentId = new Map(
    input.environments.map(
      (environment) => [environment.environmentId, environment.label] as const,
    ),
  );

  return {
    isReady,
    preference: resolveMobileInterfaceLocalePreference(
      input.preferencesReady ? (winner ?? undefined) : undefined,
    ),
    preferencePatch,
    plan,
    unsupportedEnvironmentLabels: labelsFor(plan.unsupportedEnvironmentIds, labelByEnvironmentId),
    deferredEnvironmentLabels: labelsFor(plan.deferredEnvironmentIds, labelByEnvironmentId),
  };
}
