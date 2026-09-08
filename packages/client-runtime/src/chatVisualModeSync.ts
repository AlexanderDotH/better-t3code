import type { ChatVisualModeSyncRecord } from "@t3tools/contracts";

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

export const CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION = 3;

export interface ChatVisualModeSyncEnvironment<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncEnvironment<ChatVisualModeSyncRecord, EnvironmentId> {}

export interface ChatVisualModeSyncWrite<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWrite<ChatVisualModeSyncRecord, EnvironmentId> {}

export interface ChatVisualModeSyncPlanInput<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlanInput<ChatVisualModeSyncRecord, EnvironmentId> {}

export interface ChatVisualModeSyncPlan<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncPlan<ChatVisualModeSyncRecord, EnvironmentId> {}

export interface ChatVisualModeSyncWriteOutcome<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncWriteOutcome<EnvironmentId> {}

export interface ChatVisualModeSyncSettlement<
  EnvironmentId extends string = string,
> extends SynchronizedPreferenceSyncSettlement<ChatVisualModeSyncRecord, EnvironmentId> {}

const chatVisualModeSyncPolicy = {
  minimumEnvironmentSettingsVersion: CHAT_VISUAL_MODE_SYNC_SETTINGS_VERSION,
  recordsEqual: (left: ChatVisualModeSyncRecord, right: ChatVisualModeSyncRecord) =>
    left.mode === right.mode &&
    left.updatedAt === right.updatedAt &&
    left.updateId === right.updateId,
};

export function planChatVisualModeSync<EnvironmentId extends string = string>(
  input: ChatVisualModeSyncPlanInput<EnvironmentId>,
): ChatVisualModeSyncPlan<EnvironmentId> {
  return planSynchronizedPreferenceSync(input, chatVisualModeSyncPolicy);
}

export function settleChatVisualModeSyncWrites<EnvironmentId extends string = string>(
  plan: ChatVisualModeSyncPlan<EnvironmentId>,
  outcomes: readonly ChatVisualModeSyncWriteOutcome<EnvironmentId>[],
): ChatVisualModeSyncSettlement<EnvironmentId> {
  return settleSynchronizedPreferenceSyncWrites(plan, outcomes);
}
