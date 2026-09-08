import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  settleProjectThreadPreviewSyncWrites,
  type ProjectThreadPreviewSyncWriteOutcome,
} from "@t3tools/client-runtime/project-thread-preview-sync";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  ProjectThreadPreviewCount,
  ProjectThreadPreviewSyncRecord,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { uuidv4 } from "../lib/uuid";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";
import {
  createMobileProjectThreadPreviewRecord,
  mobileProjectThreadPreviewPreferencePatch,
  nextMobileProjectThreadPreviewUpdatedAt,
} from "./project-thread-preview-preference";
import {
  deriveMobileProjectThreadPreviewSync,
  type MobileProjectThreadPreviewSyncEnvironment,
} from "./project-thread-preview-sync";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";
import { useEnvironments } from "./environments";

export interface MobileProjectThreadPreviewSyncState {
  readonly count: ProjectThreadPreviewCount;
  readonly isReady: boolean;
  readonly isSyncing: boolean;
  readonly failedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly setCount: (count: ProjectThreadPreviewCount) => void;
}

function writeKey(record: ProjectThreadPreviewSyncRecord): string {
  return `${record.updatedAt}:${record.updateId}`;
}

function updateIds(
  current: readonly EnvironmentId[],
  additions: readonly EnvironmentId[],
  removals: readonly EnvironmentId[],
): readonly EnvironmentId[] {
  const next = new Set(current);
  for (const environmentId of additions) next.add(environmentId);
  for (const environmentId of removals) next.delete(environmentId);
  return [...next].sort();
}

function sameIds(left: readonly EnvironmentId[], right: readonly EnvironmentId[]): boolean {
  return (
    left.length === right.length &&
    left.every((environmentId, index) => environmentId === right[index])
  );
}

function setIds(
  setter: (update: (current: readonly EnvironmentId[]) => readonly EnvironmentId[]) => void,
  additions: readonly EnvironmentId[],
  removals: readonly EnvironmentId[],
): void {
  setter((current) => {
    const next = updateIds(current, additions, removals);
    return sameIds(current, next) ? current : next;
  });
}

function recordMatches(
  left: ProjectThreadPreviewSyncRecord | null,
  right: ProjectThreadPreviewSyncRecord | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.count === right.count &&
      left.updatedAt === right.updatedAt &&
      left.updateId === right.updateId)
  );
}

export function useProjectThreadPreviewSync(): MobileProjectThreadPreviewSyncState {
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const updateServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    reportFailure: false,
  });
  const { isReady: catalogReady, environments } = useEnvironments();
  const [failedEnvironmentIds, setFailedEnvironmentIds] = useState<readonly EnvironmentId[]>([]);
  const [inFlightEnvironmentIds, setInFlightEnvironmentIds] = useState<readonly EnvironmentId[]>(
    [],
  );
  const attemptedWriteByEnvironment = useRef(new Map<EnvironmentId, string>());
  const attemptedPreferencePatch = useRef<string | null>(null);
  const lastLocalUpdatedAt = useRef(0);

  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  const localRecord = preferences?.projectThreadPreviewSyncRecord;

  const syncEnvironments = useMemo(
    (): readonly MobileProjectThreadPreviewSyncEnvironment<EnvironmentId>[] =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        connected: environment.connection.phase === "connected",
        configLoaded: environment.serverConfig !== null,
        environmentSettingsVersion:
          environment.serverConfig?.environment.capabilities.environmentSettingsVersion,
        record: environment.serverConfig?.settings.projectThreadPreviewSyncRecord ?? null,
      })),
    [environments],
  );

  const sync = useMemo(
    () =>
      deriveMobileProjectThreadPreviewSync({
        preferencesReady,
        catalogReady,
        localRecord,
        migrationVersion: preferences?.projectThreadPreviewMigrationVersion,
        environments: syncEnvironments,
      }),
    [
      catalogReady,
      localRecord,
      preferences?.projectThreadPreviewMigrationVersion,
      preferencesReady,
      syncEnvironments,
    ],
  );

  const labelByEnvironmentId = useMemo(
    () =>
      new Map(
        syncEnvironments.map(
          (environment) => [environment.environmentId, environment.label] as const,
        ),
      ),
    [syncEnvironments],
  );

  useEffect(() => {
    const patch = sync.preferencePatch;
    if (patch === null) return;
    const patchKey = patch.projectThreadPreviewSyncRecord?.updateId ?? "migration:1";
    if (attemptedPreferencePatch.current === patchKey) return;
    attemptedPreferencePatch.current = patchKey;
    savePreferences(patch);
  }, [savePreferences, sync.preferencePatch]);

  useEffect(() => {
    const connectedEnvironmentIds = new Set(
      syncEnvironments
        .filter((environment) => environment.connected)
        .map((environment) => environment.environmentId),
    );
    const resetEnvironmentIds: EnvironmentId[] = [];
    for (const environmentId of attemptedWriteByEnvironment.current.keys()) {
      if (!connectedEnvironmentIds.has(environmentId)) {
        attemptedWriteByEnvironment.current.delete(environmentId);
        resetEnvironmentIds.push(environmentId);
      }
    }
    if (resetEnvironmentIds.length > 0) {
      setIds(setInFlightEnvironmentIds, [], resetEnvironmentIds);
    }

    const writes = sync.plan.writes.filter((write) => {
      const key = writeKey(write.record);
      if (attemptedWriteByEnvironment.current.get(write.environmentId) === key) return false;
      attemptedWriteByEnvironment.current.set(write.environmentId, key);
      return true;
    });
    if (writes.length === 0) return;

    const writeEnvironmentIds = writes.map((write) => write.environmentId);
    setIds(setInFlightEnvironmentIds, writeEnvironmentIds, []);

    void Promise.all(
      writes.map(
        async (write): Promise<ProjectThreadPreviewSyncWriteOutcome<EnvironmentId> | null> => {
          const result = await updateServerSettings({
            environmentId: write.environmentId,
            input: { patch: { projectThreadPreviewSyncRecord: write.record } },
          });
          if (
            attemptedWriteByEnvironment.current.get(write.environmentId) !== writeKey(write.record)
          ) {
            return null;
          }
          if (result._tag === "Success") {
            return { environmentId: write.environmentId, status: "success" };
          }
          return isAtomCommandInterrupted(result)
            ? null
            : { environmentId: write.environmentId, status: "failure" };
        },
      ),
    ).then((results) => {
      const outcomes = results.filter(
        (outcome): outcome is ProjectThreadPreviewSyncWriteOutcome<EnvironmentId> =>
          outcome !== null,
      );
      const settlement = settleProjectThreadPreviewSyncWrites(sync.plan, outcomes);
      setIds(
        setFailedEnvironmentIds,
        settlement.failedEnvironmentIds,
        settlement.successfulEnvironmentIds,
      );
      const completedEnvironmentIds = writes
        .filter(
          (write) =>
            attemptedWriteByEnvironment.current.get(write.environmentId) === writeKey(write.record),
        )
        .map((write) => write.environmentId);
      setIds(setInFlightEnvironmentIds, [], completedEnvironmentIds);
    });
  }, [sync.plan, syncEnvironments, updateServerSettings]);

  useEffect(() => {
    const winner = sync.plan.winner;
    if (winner === null) return;
    const synchronizedEnvironmentIds = syncEnvironments
      .filter((environment) => environment.connected && recordMatches(environment.record, winner))
      .map((environment) => environment.environmentId);
    setIds(setFailedEnvironmentIds, [], synchronizedEnvironmentIds);
  }, [sync.plan.winner, syncEnvironments]);

  const setCount = useCallback(
    (count: ProjectThreadPreviewCount) => {
      const updatedAt = nextMobileProjectThreadPreviewUpdatedAt({
        now: Date.now(),
        winnerUpdatedAt: sync.plan.winner?.updatedAt,
        previousLocalUpdatedAt: lastLocalUpdatedAt.current,
      });
      lastLocalUpdatedAt.current = updatedAt;
      const record = createMobileProjectThreadPreviewRecord(count, updatedAt, `mobile:${uuidv4()}`);
      attemptedPreferencePatch.current = record.updateId;
      savePreferences(mobileProjectThreadPreviewPreferencePatch(record));
      setFailedEnvironmentIds([]);
    },
    [savePreferences, sync.plan.winner?.updatedAt],
  );

  const failedEnvironmentLabels = useMemo(
    () =>
      failedEnvironmentIds.map(
        (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
      ),
    [failedEnvironmentIds, labelByEnvironmentId],
  );

  return {
    count: sync.count,
    isReady: preferencesReady,
    isSyncing: inFlightEnvironmentIds.length > 0,
    failedEnvironmentLabels,
    deferredEnvironmentLabels: sync.deferredEnvironmentLabels,
    unsupportedEnvironmentLabels: sync.unsupportedEnvironmentLabels,
    setCount,
  };
}
