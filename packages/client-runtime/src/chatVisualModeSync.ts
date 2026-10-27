import {
  chatVisualModeToLegacyRecord,
  type ChatVisualModeSyncRecord,
  type ChatVisualModeSyncRecordV2,
  type ServerSettingsPatch,
} from "@t3tools/contracts";

import {
  planSynchronizedPreferenceSync,
  settleSynchronizedPreferenceSyncWrites,
  type SynchronizedPreferenceSyncPlan,
  type SynchronizedPreferenceSyncSettlement,
  type SynchronizedPreferenceSyncWrite,
  type SynchronizedPreferenceSyncWriteOutcome,
} from "./synchronizedPreferenceSync.ts";

export const CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION = 3;
const CHAT_VISUAL_MODE_V2_SYNC_SETTINGS_VERSION = 6;

export interface ChatVisualModeSyncEnvironment<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly connected: boolean;
  readonly record: ChatVisualModeSyncRecord | null;
  readonly recordV2?: ChatVisualModeSyncRecordV2 | null;
}

export interface ChatVisualModeSyncWrite<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWrite<ChatVisualModeSyncRecordV2, EnvironmentId> {
  readonly recordVersion?: 2;
}

export interface ChatVisualModeSyncPlanInput<EnvironmentId extends string = string> {
  readonly localRecord: ChatVisualModeSyncRecord | null;
  readonly localRecordV2?: ChatVisualModeSyncRecordV2 | null;
  readonly environments: readonly ChatVisualModeSyncEnvironment<EnvironmentId>[];
  readonly pendingWrites?: readonly ChatVisualModeSyncWrite<EnvironmentId>[];
}

export interface ChatVisualModeSyncPlan<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlan<ChatVisualModeSyncRecordV2, EnvironmentId> {
  readonly writes: readonly ChatVisualModeSyncWrite<EnvironmentId>[];
  readonly pendingWrites: readonly ChatVisualModeSyncWrite<EnvironmentId>[];
}

export interface ChatVisualModeSyncWriteOutcome<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWriteOutcome<EnvironmentId> {}

export interface ChatVisualModeSyncSettlement<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncSettlement<ChatVisualModeSyncRecordV2, EnvironmentId> {
  readonly writes: readonly ChatVisualModeSyncWrite<EnvironmentId>[];
  readonly pendingWrites: readonly ChatVisualModeSyncWrite<EnvironmentId>[];
}

const chatVisualModeSyncPolicy = {
  minimumEnvironmentSettingsVersion: CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
  recordsEqual: (left: ChatVisualModeSyncRecordV2, right: ChatVisualModeSyncRecordV2) =>
    left.mode === right.mode &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId,
};

function sameClock(left: ChatVisualModeSyncRecordV2, right: ChatVisualModeSyncRecordV2): boolean {
  return left.updatedAt === right.updatedAt && left.updateId === right.updateId;
}

export function selectLatestChatVisualModeRecord(
  left: ChatVisualModeSyncRecordV2 | null,
  right: ChatVisualModeSyncRecordV2 | null,
): ChatVisualModeSyncRecordV2 | null {
  if (left === null) return right;
  if (right === null) return left;
  const rightIsNewer =
    right.updatedAt > left.updatedAt ||
    (right.updatedAt === left.updatedAt && right.updateId > left.updateId);
  // Recover the authoritative V2 choice from a V1 mirror migrated at the same clock.
  const restoresBetterT3 =
    sameClock(left, right) && left.mode === "current" && right.mode === "better-t3";
  return rightIsNewer || restoresBetterT3 ? right : left;
}

function latestRecord(
  records: readonly (ChatVisualModeSyncRecordV2 | null | undefined)[],
): ChatVisualModeSyncRecordV2 | null {
  return records.reduce<ChatVisualModeSyncRecordV2 | null>(
    (winner, record) => selectLatestChatVisualModeRecord(winner, record ?? null),
    null,
  );
}

export function chatVisualModeSyncWritePatch(write: ChatVisualModeSyncWrite): ServerSettingsPatch {
  if (write.recordVersion === 2) return { chatVisualModeSyncRecordV2: write.record };
  if (write.record.mode === "better-t3") {
    throw new Error("Better T3 requires chat visual mode synchronization version 2.");
  }
  return { chatVisualModeSyncRecord: chatVisualModeToLegacyRecord(write.record) };
}

export function planChatVisualModeSync<EnvironmentId extends string = string>(
  input: ChatVisualModeSyncPlanInput<EnvironmentId>,
): ChatVisualModeSyncPlan<EnvironmentId> {
  const connected = input.environments.filter((environment) => environment.connected);
  const recordsV2 = [
    input.localRecordV2,
    ...connected
      .filter(
        (environment) =>
          (environment.environmentSettingsVersion ?? 0) >=
          CHAT_VISUAL_MODE_V2_SYNC_SETTINGS_VERSION,
      )
      .map((environment) => environment.recordV2),
  ];
  // V2 fields precede legacy mirrors so equal-clock updates keep their richer representation.
  const winner = latestRecord([
    ...recordsV2,
    input.localRecord,
    ...connected
      .filter(
        (environment) =>
          (environment.environmentSettingsVersion ?? 0) >= CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
      )
      .map((environment) => environment.record),
  ]);
  const supportedEnvironments = input.environments.filter((environment) => {
    const version = environment.environmentSettingsVersion ?? 0;
    return (
      version >=
      (winner?.mode === "better-t3"
        ? CHAT_VISUAL_MODE_V2_SYNC_SETTINGS_VERSION
        : CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION)
    );
  });
  const supportedIds = new Set(
    supportedEnvironments.map((environment) => environment.environmentId),
  );
  const usesV2 = new Set(
    supportedEnvironments
      .filter(
        (environment) =>
          (environment.environmentSettingsVersion ?? 0) >=
          CHAT_VISUAL_MODE_V2_SYNC_SETTINGS_VERSION,
      )
      .map((environment) => environment.environmentId),
  );
  const plan = planSynchronizedPreferenceSync<ChatVisualModeSyncRecordV2, EnvironmentId>(
    {
      localRecord: winner,
      environments: supportedEnvironments.map((environment) => {
        const record = usesV2.has(environment.environmentId)
          ? (environment.recordV2 ?? null)
          : environment.record;
        return {
          ...environment,
          // Repair a migrated mirror with the authoritative V2 value at the same clock.
          record:
            record !== null &&
            winner !== null &&
            sameClock(record, winner) &&
            record.mode !== winner.mode
              ? null
              : record,
        };
      }),
      pendingWrites: (input.pendingWrites ?? []).filter((write) =>
        supportedIds.has(write.environmentId),
      ),
    },
    chatVisualModeSyncPolicy,
  );
  const versionWrite = (
    write: SynchronizedPreferenceSyncWrite<ChatVisualModeSyncRecordV2, EnvironmentId>,
  ): ChatVisualModeSyncWrite<EnvironmentId> =>
    usesV2.has(write.environmentId) ? { ...write, recordVersion: 2 } : write;
  return {
    ...plan,
    writes: plan.writes.map(versionWrite),
    pendingWrites: plan.pendingWrites.map(versionWrite),
    unsupportedEnvironmentIds: input.environments
      .filter((environment) => !supportedIds.has(environment.environmentId))
      .map((environment) => environment.environmentId),
  };
}

export function settleChatVisualModeSyncWrites<EnvironmentId extends string = string>(
  plan: ChatVisualModeSyncPlan<EnvironmentId>,
  outcomes: readonly ChatVisualModeSyncWriteOutcome<EnvironmentId>[],
): ChatVisualModeSyncSettlement<EnvironmentId> {
  return settleSynchronizedPreferenceSyncWrites(plan, outcomes);
}
