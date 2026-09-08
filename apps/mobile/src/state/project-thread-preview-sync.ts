import {
  planProjectThreadPreviewSync,
  type ProjectThreadPreviewSyncPlan,
} from "@t3tools/client-runtime/project-thread-preview-sync";
import type { ProjectThreadPreviewCount, ProjectThreadPreviewSyncRecord } from "@t3tools/contracts";

import type { Preferences } from "../persistence/mobile-preferences";
import {
  initializeMobileProjectThreadPreviewPreference,
  mobileProjectThreadPreviewPreferencePatch,
  resolveMobileProjectThreadPreviewCount,
} from "./project-thread-preview-preference";

export interface MobileProjectThreadPreviewSyncEnvironment<EnvironmentId extends string = string> {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly connected: boolean;
  readonly configLoaded: boolean;
  readonly environmentSettingsVersion: number | null | undefined;
  readonly record: ProjectThreadPreviewSyncRecord | null;
}

export interface MobileProjectThreadPreviewSyncResult<EnvironmentId extends string = string> {
  readonly isReady: boolean;
  readonly count: ProjectThreadPreviewCount;
  readonly preferencePatch: Pick<
    Preferences,
    "projectThreadPreviewSyncRecord" | "projectThreadPreviewMigrationVersion"
  > | null;
  readonly plan: ProjectThreadPreviewSyncPlan<EnvironmentId>;
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
}

function recordsMatch(
  left: ProjectThreadPreviewSyncRecord | undefined,
  right: ProjectThreadPreviewSyncRecord,
): boolean {
  return (
    left?.count === right.count &&
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

export function deriveMobileProjectThreadPreviewSync<EnvironmentId extends string = string>(input: {
  readonly preferencesReady: boolean;
  readonly catalogReady: boolean;
  readonly localRecord: ProjectThreadPreviewSyncRecord | undefined;
  readonly migrationVersion: Preferences["projectThreadPreviewMigrationVersion"];
  readonly environments: readonly MobileProjectThreadPreviewSyncEnvironment<EnvironmentId>[];
}): MobileProjectThreadPreviewSyncResult<EnvironmentId> {
  const configuredEnvironments = input.environments.filter(
    (environment) => environment.configLoaded,
  );
  const plan = planProjectThreadPreviewSync({
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

  let preferencePatch: MobileProjectThreadPreviewSyncResult<EnvironmentId>["preferencePatch"] =
    null;
  if (isReady && plan.winner !== null) {
    if (!recordsMatch(input.localRecord, plan.winner) || input.migrationVersion !== 1) {
      preferencePatch = mobileProjectThreadPreviewPreferencePatch(plan.winner);
    }
  } else if (isReady) {
    preferencePatch = initializeMobileProjectThreadPreviewPreference({
      localRecord: input.localRecord,
      migrationVersion: input.migrationVersion,
      remoteRecordExists: false,
    });
  }

  const labelByEnvironmentId = new Map(
    input.environments.map(
      (environment) => [environment.environmentId, environment.label] as const,
    ),
  );

  return {
    isReady,
    count: resolveMobileProjectThreadPreviewCount(
      input.preferencesReady ? (plan.winner ?? undefined) : undefined,
    ),
    preferencePatch,
    plan,
    unsupportedEnvironmentLabels: labelsFor(plan.unsupportedEnvironmentIds, labelByEnvironmentId),
    deferredEnvironmentLabels: labelsFor(plan.deferredEnvironmentIds, labelByEnvironmentId),
  };
}
