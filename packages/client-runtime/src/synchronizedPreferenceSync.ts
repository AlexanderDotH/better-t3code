export interface SynchronizedPreferenceRecord {
  readonly updatedAt: number;
  readonly updateId: string;
}

export interface SynchronizedPreferenceSyncPolicy<Record extends SynchronizedPreferenceRecord> {
  readonly minimumEnvironmentSettingsVersion: number;
  readonly recordsEqual: (left: Record, right: Record) => boolean;
}

export interface SynchronizedPreferenceSyncEnvironment<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
> {
  readonly environmentId: EnvironmentId;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly connected: boolean;
  readonly record: Record | null;
}

export interface SynchronizedPreferenceSyncWrite<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
> {
  readonly environmentId: EnvironmentId;
  readonly record: Record;
}

export interface SynchronizedPreferenceSyncPlanInput<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
> {
  readonly localRecord: Record | null;
  readonly environments: readonly SynchronizedPreferenceSyncEnvironment<Record, EnvironmentId>[];
  readonly pendingWrites?: readonly SynchronizedPreferenceSyncWrite<Record, EnvironmentId>[];
}

export interface SynchronizedPreferenceSyncPlan<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
> {
  readonly winner: Record | null;
  readonly nextLocalRecord: Record | null;
  readonly writes: readonly SynchronizedPreferenceSyncWrite<Record, EnvironmentId>[];
  readonly pendingWrites: readonly SynchronizedPreferenceSyncWrite<Record, EnvironmentId>[];
  readonly unsupportedEnvironmentIds: readonly EnvironmentId[];
  readonly deferredEnvironmentIds: readonly EnvironmentId[];
}

export interface SynchronizedPreferenceSyncWriteOutcome<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly status: "success" | "failure";
}

export interface SynchronizedPreferenceSyncSettlement<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlan<Record, EnvironmentId> {
  readonly successfulEnvironmentIds: readonly EnvironmentId[];
  readonly failedEnvironmentIds: readonly EnvironmentId[];
  readonly unreportedEnvironmentIds: readonly EnvironmentId[];
  readonly hasPartialFailure: boolean;
  readonly isFullySynchronized: boolean;
}

function compareRecords<Record extends SynchronizedPreferenceRecord>(
  left: Record,
  right: Record,
): number {
  if (left.updatedAt !== right.updatedAt) return left.updatedAt < right.updatedAt ? -1 : 1;
  if (left.updateId === right.updateId) return 0;
  return left.updateId < right.updateId ? -1 : 1;
}

function latestRecord<Record extends SynchronizedPreferenceRecord>(
  records: Iterable<Record | null>,
): Record | null {
  let winner: Record | null = null;
  for (const record of records) {
    if (record !== null && (winner === null || compareRecords(record, winner) > 0)) {
      winner = record;
    }
  }
  return winner;
}

function target<Record extends SynchronizedPreferenceRecord, EnvironmentId extends string>(
  environmentId: EnvironmentId,
  record: Record,
): SynchronizedPreferenceSyncWrite<Record, EnvironmentId> {
  return { environmentId, record };
}

export function planSynchronizedPreferenceSync<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
>(
  input: SynchronizedPreferenceSyncPlanInput<Record, EnvironmentId>,
  policy: SynchronizedPreferenceSyncPolicy<Record>,
): SynchronizedPreferenceSyncPlan<Record, EnvironmentId> {
  const supportsSync = (version: number | null | undefined) =>
    (version ?? 0) >= policy.minimumEnvironmentSettingsVersion;
  const compatibleConnectedRecords = input.environments
    .filter(
      (environment) =>
        environment.connected && supportsSync(environment.environmentSettingsVersion),
    )
    .map((environment) => environment.record);
  const winner = latestRecord([input.localRecord, ...compatibleConnectedRecords]);
  const previousPending = new Map(
    (input.pendingWrites ?? []).map((write) => [write.environmentId, write] as const),
  );
  const writes: SynchronizedPreferenceSyncWrite<Record, EnvironmentId>[] = [];
  const pendingWrites: SynchronizedPreferenceSyncWrite<Record, EnvironmentId>[] = [];
  const unsupportedEnvironmentIds: EnvironmentId[] = [];
  const deferredEnvironmentIds: EnvironmentId[] = [];

  for (const environment of input.environments) {
    if (!supportsSync(environment.environmentSettingsVersion)) {
      unsupportedEnvironmentIds.push(environment.environmentId);
      continue;
    }
    if (winner === null) continue;

    if (environment.connected) {
      if (environment.record !== null && policy.recordsEqual(environment.record, winner)) continue;
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

export function settleSynchronizedPreferenceSyncWrites<
  Record extends SynchronizedPreferenceRecord,
  EnvironmentId extends string = string,
>(
  plan: SynchronizedPreferenceSyncPlan<Record, EnvironmentId>,
  outcomes: readonly SynchronizedPreferenceSyncWriteOutcome<EnvironmentId>[],
): SynchronizedPreferenceSyncSettlement<Record, EnvironmentId> {
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
