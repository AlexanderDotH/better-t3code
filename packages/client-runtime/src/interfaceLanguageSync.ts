import type { InterfaceLanguageSyncRecord, InterfaceLocaleSyncRecordV1 } from "@t3tools/contracts";

import {
  planSynchronizedPreferenceSync,
  settleSynchronizedPreferenceSyncWrites,
  type SynchronizedPreferenceSyncEnvironment,
  type SynchronizedPreferenceSyncPlan,
  type SynchronizedPreferenceSyncPlanInput,
  type SynchronizedPreferenceSyncSettlement,
  type SynchronizedPreferenceSyncWrite,
  type SynchronizedPreferenceSyncWriteOutcome,
} from "./synchronizedPreferenceSync.ts";

export const INTERFACE_LANGUAGE_SYNC_SETTINGS_VERSION = 4;
export const INTERFACE_LOCALE_SYNC_SETTINGS_VERSION = 5;

export function toInterfaceLocaleRecordV1(
  record: InterfaceLanguageSyncRecord,
): InterfaceLocaleSyncRecordV1 {
  return { version: 1, ...record };
}

function compareInterfaceLocaleRecords(
  left: Pick<InterfaceLocaleSyncRecordV1, "updatedAt" | "updateId">,
  right: Pick<InterfaceLocaleSyncRecordV1, "updatedAt" | "updateId">,
): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? -1 : 1;
  if (left.updateId === right.updateId) return 0;
  return left.updateId < right.updateId ? -1 : 1;
}

export function resolveInterfaceLocaleSyncRecord(input: {
  readonly localeRecord: InterfaceLocaleSyncRecordV1 | null;
  readonly legacyRecord: InterfaceLanguageSyncRecord | null;
}): InterfaceLocaleSyncRecordV1 | null {
  if (input.localeRecord === null) {
    return input.legacyRecord === null ? null : toInterfaceLocaleRecordV1(input.legacyRecord);
  }
  if (input.legacyRecord === null) return input.localeRecord;
  const legacyV1 = toInterfaceLocaleRecordV1(input.legacyRecord);
  return compareInterfaceLocaleRecords(legacyV1, input.localeRecord) > 0
    ? legacyV1
    : input.localeRecord;
}

export function createInterfaceLocaleCompatibilityMirror(
  localeRecord: InterfaceLocaleSyncRecordV1 | null,
  legacyRecord: InterfaceLanguageSyncRecord | null,
): InterfaceLanguageSyncRecord | null {
  if (localeRecord === null || localeRecord.preference === "fr") return legacyRecord;
  const mirror: InterfaceLanguageSyncRecord = {
    preference: localeRecord.preference,
    updatedAt: localeRecord.updatedAt,
    updateId: localeRecord.updateId,
  };
  if (legacyRecord === null) return mirror;
  return compareInterfaceLocaleRecords(legacyRecord, mirror) > 0 ? legacyRecord : mirror;
}

export interface InterfaceLocaleSyncEnvironment<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncEnvironment<InterfaceLocaleSyncRecordV1, EnvironmentId> {}

export interface InterfaceLocaleSyncPlanInput<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlanInput<InterfaceLocaleSyncRecordV1, EnvironmentId> {}

export interface InterfaceLocaleSyncPlan<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlan<InterfaceLocaleSyncRecordV1, EnvironmentId> {}

export interface InterfaceLocaleSyncWrite<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWrite<InterfaceLocaleSyncRecordV1, EnvironmentId> {}

export interface InterfaceLocaleSyncWriteOutcome<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWriteOutcome<EnvironmentId> {}

export interface InterfaceLocaleSyncSettlement<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncSettlement<InterfaceLocaleSyncRecordV1, EnvironmentId> {}

const interfaceLocaleSyncPolicy = {
  minimumEnvironmentSettingsVersion: INTERFACE_LOCALE_SYNC_SETTINGS_VERSION,
  recordsEqual: (left: InterfaceLocaleSyncRecordV1, right: InterfaceLocaleSyncRecordV1) =>
    left.version === right.version &&
    left.preference === right.preference &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId,
};

export function planInterfaceLocaleSync<EnvironmentId extends string = string>(
  input: InterfaceLocaleSyncPlanInput<EnvironmentId>,
): InterfaceLocaleSyncPlan<EnvironmentId> {
  return planSynchronizedPreferenceSync(input, interfaceLocaleSyncPolicy);
}

export function settleInterfaceLocaleSyncWrites<EnvironmentId extends string = string>(
  plan: InterfaceLocaleSyncPlan<EnvironmentId>,
  outcomes: readonly InterfaceLocaleSyncWriteOutcome<EnvironmentId>[],
): InterfaceLocaleSyncSettlement<EnvironmentId> {
  return settleSynchronizedPreferenceSyncWrites(plan, outcomes);
}

export interface InterfaceLanguageSyncEnvironment<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncEnvironment<InterfaceLanguageSyncRecord, EnvironmentId> {}

export interface InterfaceLanguageSyncWrite<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWrite<InterfaceLanguageSyncRecord, EnvironmentId> {}

export interface InterfaceLanguageSyncPlanInput<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlanInput<InterfaceLanguageSyncRecord, EnvironmentId> {}

export interface InterfaceLanguageSyncPlan<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlan<InterfaceLanguageSyncRecord, EnvironmentId> {}

export interface InterfaceLanguageSyncWriteOutcome<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWriteOutcome<EnvironmentId> {}

export interface InterfaceLanguageSyncSettlement<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncSettlement<InterfaceLanguageSyncRecord, EnvironmentId> {}

const interfaceLanguageSyncPolicy = {
  minimumEnvironmentSettingsVersion: INTERFACE_LANGUAGE_SYNC_SETTINGS_VERSION,
  recordsEqual: (left: InterfaceLanguageSyncRecord, right: InterfaceLanguageSyncRecord) =>
    left.preference === right.preference &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId,
};

export function planInterfaceLanguageSync<EnvironmentId extends string = string>(
  input: InterfaceLanguageSyncPlanInput<EnvironmentId>,
): InterfaceLanguageSyncPlan<EnvironmentId> {
  return planSynchronizedPreferenceSync(input, interfaceLanguageSyncPolicy);
}

export function settleInterfaceLanguageSyncWrites<EnvironmentId extends string = string>(
  plan: InterfaceLanguageSyncPlan<EnvironmentId>,
  outcomes: readonly InterfaceLanguageSyncWriteOutcome<EnvironmentId>[],
): InterfaceLanguageSyncSettlement<EnvironmentId> {
  return settleSynchronizedPreferenceSyncWrites(plan, outcomes);
}

export interface InterfaceLocaleCompatibilitySyncEnvironment<
  EnvironmentId extends string = string,
> {
  readonly environmentId: EnvironmentId;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly connected: boolean;
  readonly localeRecord: InterfaceLocaleSyncRecordV1 | null;
  readonly legacyRecord: InterfaceLanguageSyncRecord | null;
}

export interface InterfaceLocaleCompatibilitySyncPlanInput<EnvironmentId extends string = string> {
  readonly localLocaleRecord: InterfaceLocaleSyncRecordV1 | null;
  readonly localLegacyRecord: InterfaceLanguageSyncRecord | null;
  readonly environments: readonly InterfaceLocaleCompatibilitySyncEnvironment<EnvironmentId>[];
  readonly pendingLocaleWrites?: readonly InterfaceLocaleSyncWrite<EnvironmentId>[];
  readonly pendingLegacyWrites?: readonly InterfaceLanguageSyncWrite<EnvironmentId>[];
}

export interface InterfaceLocaleCompatibilitySyncPlan<EnvironmentId extends string = string> {
  readonly winner: InterfaceLocaleSyncRecordV1 | null;
  readonly nextLocalLocaleRecord: InterfaceLocaleSyncRecordV1 | null;
  readonly nextLocalLegacyRecord: InterfaceLanguageSyncRecord | null;
  readonly localePlan: InterfaceLocaleSyncPlan<EnvironmentId>;
  readonly legacyPlan: InterfaceLanguageSyncPlan<EnvironmentId>;
  readonly unsupportedEnvironmentIds: readonly EnvironmentId[];
  readonly deferredEnvironmentIds: readonly EnvironmentId[];
}

function latestInterfaceLocaleRecord(
  records: Iterable<InterfaceLocaleSyncRecordV1 | null>,
): InterfaceLocaleSyncRecordV1 | null {
  let winner: InterfaceLocaleSyncRecordV1 | null = null;
  for (const record of records) {
    if (record !== null && (winner === null || compareInterfaceLocaleRecords(record, winner) > 0)) {
      winner = record;
    }
  }
  return winner;
}

function emptyInterfaceLanguagePlan<EnvironmentId extends string>(
  winner: InterfaceLanguageSyncRecord | null,
): InterfaceLanguageSyncPlan<EnvironmentId> {
  return {
    winner,
    nextLocalRecord: winner,
    writes: [],
    pendingWrites: [],
    unsupportedEnvironmentIds: [],
    deferredEnvironmentIds: [],
  };
}

/**
 * Elects one locale across V1 and legacy environments, then emits only the
 * schema each environment can decode. French never overwrites a legacy-only
 * environment, while a newer legacy en/de/system record can still win.
 */
export function planInterfaceLocaleCompatibilitySync<EnvironmentId extends string = string>(
  input: InterfaceLocaleCompatibilitySyncPlanInput<EnvironmentId>,
): InterfaceLocaleCompatibilitySyncPlan<EnvironmentId> {
  const effectiveLocal = resolveInterfaceLocaleSyncRecord({
    localeRecord: input.localLocaleRecord,
    legacyRecord: input.localLegacyRecord,
  });
  const connectedRecords = input.environments
    .filter((environment) => environment.connected)
    .map((environment) => {
      const version = environment.environmentSettingsVersion ?? 0;
      if (version >= INTERFACE_LOCALE_SYNC_SETTINGS_VERSION) {
        return resolveInterfaceLocaleSyncRecord({
          localeRecord: environment.localeRecord,
          legacyRecord: environment.legacyRecord,
        });
      }
      if (
        version >= INTERFACE_LANGUAGE_SYNC_SETTINGS_VERSION &&
        environment.legacyRecord !== null
      ) {
        return toInterfaceLocaleRecordV1(environment.legacyRecord);
      }
      return null;
    });
  const winner = latestInterfaceLocaleRecord([effectiveLocal, ...connectedRecords]);
  const localeEnvironments = input.environments.filter(
    (environment) =>
      (environment.environmentSettingsVersion ?? 0) >= INTERFACE_LOCALE_SYNC_SETTINGS_VERSION,
  );
  const localeEnvironmentIds = new Set(
    localeEnvironments.map((environment) => environment.environmentId),
  );
  const localePlan = planInterfaceLocaleSync<EnvironmentId>({
    localRecord: winner,
    environments: localeEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      environmentSettingsVersion: environment.environmentSettingsVersion,
      connected: environment.connected,
      // Winner election may promote a legacy record, but a v5 target is only
      // repaired once its actual V1 field contains that winner.
      record: environment.localeRecord,
    })),
    pendingWrites:
      input.pendingLocaleWrites?.filter((write) => localeEnvironmentIds.has(write.environmentId)) ??
      [],
  });
  const legacyEnvironments = input.environments.filter((environment) => {
    const version = environment.environmentSettingsVersion ?? 0;
    return (
      version >= INTERFACE_LANGUAGE_SYNC_SETTINGS_VERSION &&
      version < INTERFACE_LOCALE_SYNC_SETTINGS_VERSION
    );
  });
  const legacyEnvironmentIds = new Set(
    legacyEnvironments.map((environment) => environment.environmentId),
  );
  const nextLocalLegacyRecord = createInterfaceLocaleCompatibilityMirror(
    winner,
    input.localLegacyRecord,
  );
  const legacyPlan =
    winner?.preference === "fr"
      ? emptyInterfaceLanguagePlan<EnvironmentId>(nextLocalLegacyRecord)
      : planInterfaceLanguageSync<EnvironmentId>({
          localRecord: nextLocalLegacyRecord,
          environments: legacyEnvironments.map((environment) => ({
            environmentId: environment.environmentId,
            environmentSettingsVersion: environment.environmentSettingsVersion,
            connected: environment.connected,
            record: environment.legacyRecord,
          })),
          pendingWrites:
            input.pendingLegacyWrites?.filter((write) =>
              legacyEnvironmentIds.has(write.environmentId),
            ) ?? [],
        });
  const unsupportedEnvironmentIds = input.environments
    .filter((environment) => {
      const version = environment.environmentSettingsVersion ?? 0;
      return (
        version < INTERFACE_LANGUAGE_SYNC_SETTINGS_VERSION ||
        (version < INTERFACE_LOCALE_SYNC_SETTINGS_VERSION && winner?.preference === "fr")
      );
    })
    .map((environment) => environment.environmentId);

  return {
    winner,
    nextLocalLocaleRecord: winner,
    nextLocalLegacyRecord,
    localePlan,
    legacyPlan,
    unsupportedEnvironmentIds,
    deferredEnvironmentIds: [
      ...localePlan.deferredEnvironmentIds,
      ...legacyPlan.deferredEnvironmentIds,
    ],
  };
}
