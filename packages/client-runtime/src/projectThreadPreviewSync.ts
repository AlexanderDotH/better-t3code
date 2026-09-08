import type { ProjectThreadPreviewSyncRecord } from "@t3tools/contracts";

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

export const PROJECT_THREAD_PREVIEW_SYNC_SETTINGS_VERSION = 2;

export interface ProjectThreadPreviewSyncEnvironment<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncEnvironment<ProjectThreadPreviewSyncRecord, EnvironmentId> {}

export interface ProjectThreadPreviewSyncWrite<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWrite<ProjectThreadPreviewSyncRecord, EnvironmentId> {}

export interface ProjectThreadPreviewSyncPlanInput<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlanInput<ProjectThreadPreviewSyncRecord, EnvironmentId> {}

export interface ProjectThreadPreviewSyncPlan<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlan<ProjectThreadPreviewSyncRecord, EnvironmentId> {}

export interface ProjectThreadPreviewSyncWriteOutcome<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWriteOutcome<EnvironmentId> {}

export interface ProjectThreadPreviewSyncSettlement<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncSettlement<ProjectThreadPreviewSyncRecord, EnvironmentId> {}

const projectThreadPreviewSyncPolicy = {
  minimumEnvironmentSettingsVersion: PROJECT_THREAD_PREVIEW_SYNC_SETTINGS_VERSION,
  recordsEqual: (left: ProjectThreadPreviewSyncRecord, right: ProjectThreadPreviewSyncRecord) =>
    left.count === right.count &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId,
};

export function planProjectThreadPreviewSync<EnvironmentId extends string = string>(
  input: ProjectThreadPreviewSyncPlanInput<EnvironmentId>,
): ProjectThreadPreviewSyncPlan<EnvironmentId> {
  return planSynchronizedPreferenceSync(input, projectThreadPreviewSyncPolicy);
}

export function settleProjectThreadPreviewSyncWrites<EnvironmentId extends string = string>(
  plan: ProjectThreadPreviewSyncPlan<EnvironmentId>,
  outcomes: readonly ProjectThreadPreviewSyncWriteOutcome<EnvironmentId>[],
): ProjectThreadPreviewSyncSettlement<EnvironmentId> {
  return settleSynchronizedPreferenceSyncWrites(plan, outcomes);
}
