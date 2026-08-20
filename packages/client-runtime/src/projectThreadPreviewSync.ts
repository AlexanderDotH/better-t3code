import type { ProjectThreadPreviewSyncRecord } from "@t3tools/contracts";

export const PROJECT_THREAD_PREVIEW_SYNC_SETTINGS_VERSION = 2;

export interface ProjectThreadPreviewSyncEnvironment<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly connected: boolean;
  readonly record: ProjectThreadPreviewSyncRecord | null;
}

export interface ProjectThreadPreviewSyncWrite<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly record: ProjectThreadPreviewSyncRecord;
}

export interface ProjectThreadPreviewSyncPlanInput<EnvironmentId extends string = string> {
  readonly localRecord: ProjectThreadPreviewSyncRecord | null;
  readonly environments: readonly ProjectThreadPreviewSyncEnvironment<EnvironmentId>[];
  readonly pendingWrites?: readonly ProjectThreadPreviewSyncWrite<EnvironmentId>[];
}

export interface ProjectThreadPreviewSyncPlan<EnvironmentId extends string = string> {
  readonly winner: ProjectThreadPreviewSyncRecord | null;
  readonly nextLocalRecord: ProjectThreadPreviewSyncRecord | null;
  readonly writes: readonly ProjectThreadPreviewSyncWrite<EnvironmentId>[];
  readonly pendingWrites: readonly ProjectThreadPreviewSyncWrite<EnvironmentId>[];
  readonly unsupportedEnvironmentIds: readonly EnvironmentId[];
  readonly deferredEnvironmentIds: readonly EnvironmentId[];
}

export interface ProjectThreadPreviewSyncWriteOutcome<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly status: "success" | "failure";
}

export interface ProjectThreadPreviewSyncSettlement<
  EnvironmentId extends string = string,
> extends ProjectThreadPreviewSyncPlan<EnvironmentId> {
  readonly successfulEnvironmentIds: readonly EnvironmentId[];
  readonly failedEnvironmentIds: readonly EnvironmentId[];
  readonly unreportedEnvironmentIds: readonly EnvironmentId[];
  readonly hasPartialFailure: boolean;
  readonly isFullySynchronized: boolean;
}

function compareRecords(
  left: ProjectThreadPreviewSyncRecord,
  right: ProjectThreadPreviewSyncRecord,
): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? -1 : 1;
  if (left.updateId === right.updateId) return 0;
  return left.updateId < right.updateId ? -1 : 1;
}

function recordsMatch(
  left: ProjectThreadPreviewSyncRecord | null,
  right: ProjectThreadPreviewSyncRecord,
): boolean {
  return (
    left !== null &&
    left.count === right.count &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId
  );
}

function latestRecord(
  records: Iterable<ProjectThreadPreviewSyncRecord | null>,
): ProjectThreadPreviewSyncRecord | null {
  let winner: ProjectThreadPreviewSyncRecord | null = null;
  for (const record of records) {
    if (record !== null && (winner === null || compareRecords(record, winner) > 0)) {
      winner = record;
    }
  }
  return winner;
}

function supportsProjectThreadPreviewSync(version: number | null | undefined): boolean {
  return (version ?? 0) >= PROJECT_THREAD_PREVIEW_SYNC_SETTINGS_VERSION;
}

function target<EnvironmentId extends string>(
  environmentId: EnvironmentId,
  record: ProjectThreadPreviewSyncRecord,
): ProjectThreadPreviewSyncWrite<EnvironmentId> {
  return { environmentId, record };
}

export function planProjectThreadPreviewSync<EnvironmentId extends string = string>(
  input: ProjectThreadPreviewSyncPlanInput<EnvironmentId>,
): ProjectThreadPreviewSyncPlan<EnvironmentId> {
  const compatibleConnectedRecords = input.environments
    .filter(
      (environment) =>
        environment.connected &&
        supportsProjectThreadPreviewSync(environment.environmentSettingsVersion),
    )
    .map((environment) => environment.record);
  const winner = latestRecord([input.localRecord, ...compatibleConnectedRecords]);
  const previousPending = new Map(
    (input.pendingWrites ?? []).map((write) => [write.environmentId, write] as const),
  );
  const writes: ProjectThreadPreviewSyncWrite<EnvironmentId>[] = [];
  const pendingWrites: ProjectThreadPreviewSyncWrite<EnvironmentId>[] = [];
  const unsupportedEnvironmentIds: EnvironmentId[] = [];
  const deferredEnvironmentIds: EnvironmentId[] = [];

  for (const environment of input.environments) {
    if (!supportsProjectThreadPreviewSync(environment.environmentSettingsVersion)) {
      unsupportedEnvironmentIds.push(environment.environmentId);
      continue;
    }
    if (winner === null) continue;

    if (environment.connected) {
      if (recordsMatch(environment.record, winner)) continue;
      if (environment.record !== null && compareRecords(environment.record, winner) >= 0) continue;

      const write = target(environment.environmentId, winner);
      writes.push(write);
      pendingWrites.push(write);
      continue;
    }

    if (environment.record !== null && compareRecords(environment.record, winner) > 0) continue;
    const wasPending = previousPending.has(environment.environmentId);
    const cachedRecordIsStale =
      environment.record === null || compareRecords(environment.record, winner) < 0;
    if (!wasPending && !cachedRecordIsStale) continue;

    pendingWrites.push(target(environment.environmentId, winner));
    deferredEnvironmentIds.push(environment.environmentId);
  }

  return {
    winner,
    nextLocalRecord: winner,
    writes,
    pendingWrites,
    unsupportedEnvironmentIds,
    deferredEnvironmentIds,
  };
}

export function settleProjectThreadPreviewSyncWrites<EnvironmentId extends string = string>(
  plan: ProjectThreadPreviewSyncPlan<EnvironmentId>,
  outcomes: readonly ProjectThreadPreviewSyncWriteOutcome<EnvironmentId>[],
): ProjectThreadPreviewSyncSettlement<EnvironmentId> {
  const plannedEnvironmentIds = new Set(plan.writes.map((write) => write.environmentId));
  const outcomeByEnvironment = new Map<EnvironmentId, "success" | "failure">();
  for (const outcome of outcomes) {
    if (plannedEnvironmentIds.has(outcome.environmentId)) {
      outcomeByEnvironment.set(outcome.environmentId, outcome.status);
    }
  }

  const successfulEnvironmentIds: EnvironmentId[] = [];
  const failedEnvironmentIds: EnvironmentId[] = [];
  const unreportedEnvironmentIds: EnvironmentId[] = [];
  for (const write of plan.writes) {
    const status = outcomeByEnvironment.get(write.environmentId);
    if (status === "success") successfulEnvironmentIds.push(write.environmentId);
    if (status === "failure") failedEnvironmentIds.push(write.environmentId);
    if (status === undefined) unreportedEnvironmentIds.push(write.environmentId);
  }

  const successfulEnvironmentIdSet = new Set(successfulEnvironmentIds);
  const pendingWrites = plan.pendingWrites.filter(
    (write) => !successfulEnvironmentIdSet.has(write.environmentId),
  );

  return {
    ...plan,
    pendingWrites,
    successfulEnvironmentIds,
    failedEnvironmentIds,
    unreportedEnvironmentIds,
    hasPartialFailure: successfulEnvironmentIds.length > 0 && failedEnvironmentIds.length > 0,
    isFullySynchronized: pendingWrites.length === 0,
  };
}
