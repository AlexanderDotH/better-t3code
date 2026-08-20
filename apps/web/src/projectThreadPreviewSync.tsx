import {
  DEFAULT_PROJECT_THREAD_PREVIEW_COUNT,
  type EnvironmentId,
  type ProjectThreadPreviewCount,
  ProjectThreadPreviewSyncRecord as ProjectThreadPreviewSyncRecordSchema,
  type ProjectThreadPreviewSyncRecord,
} from "@t3tools/contracts";
import {
  planProjectThreadPreviewSync,
  settleProjectThreadPreviewSyncWrites,
  type ProjectThreadPreviewSyncWrite,
} from "@t3tools/client-runtime/project-thread-preview-sync";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { useLocalStorage } from "./hooks/useLocalStorage";
import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "./hooks/useSettings";
import { useEnvironments } from "./state/environments";
import { serverEnvironment } from "./state/server";
import { useAtomCommand } from "./state/use-atom-command";
import { toastManager } from "./components/ui/toast";
import { randomUUID } from "./lib/utils";

export const PROJECT_THREAD_PREVIEW_SYNC_STORAGE_KEY = "t3code:project-thread-preview-sync:v1";

const ProjectThreadPreviewSyncCache = Schema.NullOr(ProjectThreadPreviewSyncRecordSchema);
const LEGACY_MIGRATION_UPDATE_ID_PREFIX = "legacy-client-settings-migration-v1";

interface ProjectThreadPreviewUpdateClock {
  readonly now: () => number;
  readonly updateId: () => string;
}

function makeUpdateId(): string {
  return `web:${randomUUID()}`;
}

const DEFAULT_UPDATE_CLOCK: ProjectThreadPreviewUpdateClock = {
  now: Date.now,
  updateId: makeUpdateId,
};

export function createProjectThreadPreviewSyncRecord(
  count: ProjectThreadPreviewCount,
  clock: ProjectThreadPreviewUpdateClock = DEFAULT_UPDATE_CLOCK,
): ProjectThreadPreviewSyncRecord {
  return {
    count,
    updatedAt: clock.now(),
    updateId: clock.updateId(),
  };
}

export function seedProjectThreadPreviewSyncRecord(
  legacyCount: ProjectThreadPreviewCount,
  migrationVersion: 1 | undefined,
): ProjectThreadPreviewSyncRecord {
  const count =
    migrationVersion === 1 || legacyCount !== 6
      ? legacyCount
      : DEFAULT_PROJECT_THREAD_PREVIEW_COUNT;
  return {
    count,
    updatedAt: 0,
    updateId: `${LEGACY_MIGRATION_UPDATE_ID_PREFIX}:${count}`,
  };
}

function formatEnvironmentLabels(labels: ReadonlyArray<string>): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function projectThreadPreviewSyncStatusText(input: {
  readonly failedEnvironmentLabels: ReadonlyArray<string>;
  readonly unsupportedEnvironmentLabels: ReadonlyArray<string>;
  readonly deferredEnvironmentLabels?: ReadonlyArray<string>;
}): string | null {
  const messages: string[] = [];
  if (input.failedEnvironmentLabels.length > 0) {
    messages.push(
      `Couldn’t sync to ${formatEnvironmentLabels(input.failedEnvironmentLabels)}. We’ll retry automatically.`,
    );
  }
  if (input.unsupportedEnvironmentLabels.length > 0) {
    messages.push(
      `Update ${formatEnvironmentLabels(input.unsupportedEnvironmentLabels)} to sync this setting.`,
    );
  }
  if ((input.deferredEnvironmentLabels?.length ?? 0) > 0) {
    messages.push(
      `Waiting for ${formatEnvironmentLabels(input.deferredEnvironmentLabels ?? [])} to reconnect.`,
    );
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

export interface ProjectThreadPreviewSyncStatus {
  readonly deferredEnvironmentLabels: ReadonlyArray<string>;
  readonly failedEnvironmentLabels: ReadonlyArray<string>;
  readonly isSyncing: boolean;
  readonly unsupportedEnvironmentLabels: ReadonlyArray<string>;
}

const EMPTY_SYNC_STATUS: ProjectThreadPreviewSyncStatus = Object.freeze({
  deferredEnvironmentLabels: Object.freeze([]),
  failedEnvironmentLabels: Object.freeze([]),
  isSyncing: false,
  unsupportedEnvironmentLabels: Object.freeze([]),
});
const syncStatusListeners = new Set<() => void>();
let syncStatusSnapshot = EMPTY_SYNC_STATUS;

function syncStatusKey(status: ProjectThreadPreviewSyncStatus): string {
  return JSON.stringify(status);
}

function replaceSyncStatus(status: ProjectThreadPreviewSyncStatus): void {
  if (syncStatusKey(syncStatusSnapshot) === syncStatusKey(status)) return;
  syncStatusSnapshot = status;
  for (const listener of syncStatusListeners) listener();
}

function subscribeSyncStatus(listener: () => void): () => void {
  syncStatusListeners.add(listener);
  return () => syncStatusListeners.delete(listener);
}

export function useProjectThreadPreviewSyncStatus(): ProjectThreadPreviewSyncStatus {
  return useSyncExternalStore(
    subscribeSyncStatus,
    () => syncStatusSnapshot,
    () => EMPTY_SYNC_STATUS,
  );
}

function recordsMatch(
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

function writeKey(write: ProjectThreadPreviewSyncWrite<EnvironmentId>): string {
  return [
    write.environmentId,
    write.record.updatedAt,
    write.record.updateId,
    write.record.count,
  ].join(":");
}

function writesMatch(
  left: ReadonlyArray<ProjectThreadPreviewSyncWrite<EnvironmentId>>,
  right: ReadonlyArray<ProjectThreadPreviewSyncWrite<EnvironmentId>>,
): boolean {
  return (
    left.length === right.length &&
    left.every((write, index) => writeKey(write) === writeKey(right[index]!))
  );
}

function useProjectThreadPreviewSyncCache() {
  return useLocalStorage(
    PROJECT_THREAD_PREVIEW_SYNC_STORAGE_KEY,
    null,
    ProjectThreadPreviewSyncCache,
  );
}

export function useProjectThreadPreviewCount(): {
  readonly count: ProjectThreadPreviewCount;
  readonly setCount: (count: ProjectThreadPreviewCount) => void;
} {
  const legacyCount = useClientSettings<ProjectThreadPreviewCount>(
    (settings) => settings.sidebarThreadPreviewCount,
  );
  const updateClientSettings = useUpdateClientSettings();
  const [record, setRecord] = useProjectThreadPreviewSyncCache();
  const setCount = useCallback(
    (count: ProjectThreadPreviewCount) => {
      setRecord(createProjectThreadPreviewSyncRecord(count));
      updateClientSettings({
        projectThreadPreviewMigrationVersion: 1,
        sidebarThreadPreviewCount: count,
      });
    },
    [setRecord, updateClientSettings],
  );

  return { count: record?.count ?? legacyCount, setCount };
}

export function ProjectThreadPreviewSyncCoordinator() {
  const settingsHydrated = useClientSettingsHydrated();
  const legacyCount = useClientSettings<ProjectThreadPreviewCount>(
    (settings) => settings.sidebarThreadPreviewCount,
  );
  const migrationVersion = useClientSettings(
    (settings) => settings.projectThreadPreviewMigrationVersion,
  );
  const updateClientSettings = useUpdateClientSettings();
  const [localRecord, setLocalRecord] = useProjectThreadPreviewSyncCache();
  const { environments, isReady } = useEnvironments();
  const persistServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "project thread preview settings sync",
    reportFailure: false,
  });
  const [pendingWrites, setPendingWrites] = useState<
    ReadonlyArray<ProjectThreadPreviewSyncWrite<EnvironmentId>>
  >([]);
  const [failedWriteKeyByEnvironment, setFailedWriteKeyByEnvironment] = useState<
    ReadonlyMap<EnvironmentId, string>
  >(() => new Map());
  const activeWriteKeys = useRef(new Set<string>());
  const confirmedWriteKeys = useRef(new Set<string>());
  const mounted = useRef(true);

  const syncEnvironments = useMemo(
    () =>
      environments.flatMap((environment) => {
        const config = environment.serverConfig;
        if (config === null) return [];
        return [
          {
            environmentId: environment.environmentId,
            environmentSettingsVersion: config.environment.capabilities.environmentSettingsVersion,
            connected: environment.connection.phase === "connected",
            record: config.settings.projectThreadPreviewSyncRecord ?? null,
          },
        ];
      }),
    [environments],
  );
  const labelByEnvironmentId = useMemo(
    () => new Map(environments.map(({ environmentId, label }) => [environmentId, label] as const)),
    [environments],
  );
  const plan = useMemo(
    () =>
      planProjectThreadPreviewSync<EnvironmentId>({
        localRecord,
        environments: syncEnvironments,
        pendingWrites,
      }),
    [localRecord, pendingWrites, syncEnvironments],
  );

  useEffect(() => {
    const connectedEnvironmentIds = new Set(
      syncEnvironments
        .filter((environment) => environment.connected)
        .map((environment) => environment.environmentId),
    );
    const pendingWriteKeyByEnvironment = new Map(
      plan.pendingWrites.map((write) => [write.environmentId, writeKey(write)] as const),
    );
    setFailedWriteKeyByEnvironment((current) => {
      const next = new Map(
        [...current].filter(
          ([environmentId, key]) =>
            connectedEnvironmentIds.has(environmentId) &&
            pendingWriteKeyByEnvironment.get(environmentId) === key,
        ),
      );
      return next.size === current.size ? current : next;
    });
  }, [plan.pendingWrites, syncEnvironments]);

  useEffect(() => {
    const plannedWriteKeys = new Set(plan.writes.map(writeKey));
    for (const key of confirmedWriteKeys.current) {
      if (!plannedWriteKeys.has(key)) confirmedWriteKeys.current.delete(key);
    }
  }, [plan.writes]);

  const status = useMemo<ProjectThreadPreviewSyncStatus>(() => {
    const labelsFor = (environmentIds: ReadonlyArray<EnvironmentId>) =>
      environmentIds.map(
        (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
      );
    const failedEnvironmentIds = plan.pendingWrites
      .filter((write) => failedWriteKeyByEnvironment.get(write.environmentId) === writeKey(write))
      .map((write) => write.environmentId);
    const isSyncing = plan.writes.some((write) => {
      const key = writeKey(write);
      return (
        !confirmedWriteKeys.current.has(key) &&
        failedWriteKeyByEnvironment.get(write.environmentId) !== key
      );
    });
    return {
      deferredEnvironmentLabels: labelsFor(plan.deferredEnvironmentIds),
      failedEnvironmentLabels: labelsFor(failedEnvironmentIds),
      isSyncing,
      unsupportedEnvironmentLabels: labelsFor(plan.unsupportedEnvironmentIds),
    };
  }, [failedWriteKeyByEnvironment, labelByEnvironmentId, plan]);

  useEffect(() => {
    replaceSyncStatus(status);
  }, [status]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      replaceSyncStatus(EMPTY_SYNC_STATUS);
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated || !isReady) return;

    if (plan.winner === null) {
      const seedRecord = seedProjectThreadPreviewSyncRecord(legacyCount, migrationVersion);
      setLocalRecord(seedRecord);
      if (seedRecord.count !== legacyCount || migrationVersion !== 1) {
        updateClientSettings({
          projectThreadPreviewMigrationVersion: 1,
          sidebarThreadPreviewCount: seedRecord.count,
        });
      }
      return;
    }

    if (!recordsMatch(localRecord, plan.nextLocalRecord)) {
      setLocalRecord(plan.nextLocalRecord);
    }
    if (legacyCount !== plan.winner.count || migrationVersion !== 1) {
      updateClientSettings({
        projectThreadPreviewMigrationVersion: 1,
        sidebarThreadPreviewCount: plan.winner.count,
      });
    }
    setPendingWrites((current) =>
      writesMatch(current, plan.pendingWrites) ? current : plan.pendingWrites,
    );

    const writes = plan.writes.filter((write) => {
      const key = writeKey(write);
      return (
        !activeWriteKeys.current.has(key) &&
        !confirmedWriteKeys.current.has(key) &&
        failedWriteKeyByEnvironment.get(write.environmentId) !== key
      );
    });
    if (writes.length === 0) return;

    for (const write of writes) activeWriteKeys.current.add(writeKey(write));
    void Promise.all(
      writes.map(async (write) => {
        const result = await persistServerSettings({
          environmentId: write.environmentId,
          input: { patch: { projectThreadPreviewSyncRecord: write.record } },
        });
        return {
          environmentId: write.environmentId,
          status: result._tag === "Success" ? ("success" as const) : ("failure" as const),
        };
      }),
    ).then((outcomes) => {
      for (const write of writes) activeWriteKeys.current.delete(writeKey(write));
      if (!mounted.current) return;

      const settlement = settleProjectThreadPreviewSyncWrites(plan, outcomes);
      for (const write of writes) {
        const key = writeKey(write);
        if (
          outcomes.some(
            (outcome) =>
              outcome.environmentId === write.environmentId && outcome.status === "success",
          )
        ) {
          confirmedWriteKeys.current.add(key);
        }
      }
      setPendingWrites((current) =>
        writesMatch(current, settlement.pendingWrites) ? current : settlement.pendingWrites,
      );
      setFailedWriteKeyByEnvironment((current) => {
        const next = new Map(current);
        for (const write of writes) {
          const outcome = outcomes.find(
            ({ environmentId }) => environmentId === write.environmentId,
          );
          if (outcome?.status === "failure") next.set(write.environmentId, writeKey(write));
          if (outcome?.status === "success") next.delete(write.environmentId);
        }
        return next;
      });

      if (settlement.failedEnvironmentIds.length > 0) {
        const failedEnvironmentLabels = settlement.failedEnvironmentIds.map(
          (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
        );
        toastManager.add({
          type: "error",
          title: settlement.hasPartialFailure
            ? "Some servers didn’t sync"
            : "Chats per project didn’t sync",
          description:
            projectThreadPreviewSyncStatusText({
              failedEnvironmentLabels,
              unsupportedEnvironmentLabels: [],
            }) ?? undefined,
        });
      }
    });
  }, [
    failedWriteKeyByEnvironment,
    isReady,
    labelByEnvironmentId,
    legacyCount,
    localRecord,
    migrationVersion,
    persistServerSettings,
    plan,
    setLocalRecord,
    settingsHydrated,
    updateClientSettings,
  ]);

  return null;
}
