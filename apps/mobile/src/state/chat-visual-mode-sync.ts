import {
  planChatVisualModeSync,
  type ChatVisualModeSyncPlan,
} from "@t3tools/client-runtime/chat-visual-mode-sync";
import {
  resolveChatVisualModeRecord,
  type ChatVisualMode,
  type ChatVisualModeSyncRecord,
  type ChatVisualModeSyncRecordV2,
} from "@t3tools/contracts";

import {
  mobileChatVisualModePreferencePatch,
  resolveMobileChatVisualMode,
  type MobileChatVisualModePreferencePatch,
} from "./chat-visual-mode-preference";

export interface MobileChatVisualModeSyncEnvironment<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly configLoaded: boolean;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly record: ChatVisualModeSyncRecord | null;
  readonly recordV2?: ChatVisualModeSyncRecordV2 | null;
}

export interface MobileChatVisualModeSyncResult<EnvironmentId extends string = string> {
  readonly isReady: boolean;
  readonly mode: ChatVisualMode;
  readonly preferencePatch: MobileChatVisualModePreferencePatch | null;
  readonly plan: ChatVisualModeSyncPlan<EnvironmentId>;
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
}

function recordsMatch(
  left: ChatVisualModeSyncRecordV2 | undefined,
  right: ChatVisualModeSyncRecordV2,
): boolean {
  return (
    left?.mode === right.mode &&
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

export function deriveMobileChatVisualModeSync<EnvironmentId extends string = string>(input: {
  readonly preferencesReady: boolean;
  readonly catalogReady: boolean;
  readonly localRecord: ChatVisualModeSyncRecord | undefined;
  readonly localRecordV2?: ChatVisualModeSyncRecordV2 | undefined;
  readonly environments: readonly MobileChatVisualModeSyncEnvironment<EnvironmentId>[];
}): MobileChatVisualModeSyncResult<EnvironmentId> {
  const configuredEnvironments = input.environments.filter(
    (environment) => environment.configLoaded,
  );
  const plan = planChatVisualModeSync({
    localRecord: input.localRecord ?? null,
    localRecordV2: input.localRecordV2 ?? null,
    environments: configuredEnvironments.map((environment) => ({
      environmentId: environment.environmentId,
      environmentSettingsVersion: environment.environmentSettingsVersion,
      connected: environment.connected,
      record: environment.record,
      recordV2: environment.recordV2 ?? null,
    })),
  });
  const isReady =
    input.preferencesReady &&
    input.catalogReady &&
    input.environments.every((environment) => !environment.connected || environment.configLoaded);
  const preferencePatch =
    isReady && plan.winner !== null && !recordsMatch(input.localRecordV2, plan.winner)
      ? mobileChatVisualModePreferencePatch(plan.winner)
      : null;
  const labelByEnvironmentId = new Map(
    input.environments.map(
      (environment) => [environment.environmentId, environment.label] as const,
    ),
  );

  return {
    isReady,
    mode: resolveMobileChatVisualMode(
      input.preferencesReady
        ? (plan.winner ??
            resolveChatVisualModeRecord(input.localRecord, input.localRecordV2) ??
            undefined)
        : undefined,
    ),
    preferencePatch,
    plan,
    unsupportedEnvironmentLabels: labelsFor(plan.unsupportedEnvironmentIds, labelByEnvironmentId),
    deferredEnvironmentLabels: labelsFor(plan.deferredEnvironmentIds, labelByEnvironmentId),
  };
}
