import type { InterfaceLanguageSyncRecord } from "@t3tools/contracts";

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
