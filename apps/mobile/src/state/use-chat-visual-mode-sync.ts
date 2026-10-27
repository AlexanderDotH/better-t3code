import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  settleChatVisualModeSyncWrites,
  chatVisualModeSyncWritePatch,
  type ChatVisualModeSyncWriteOutcome,
} from "@t3tools/client-runtime/chat-visual-mode-sync";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  resolveChatVisualModeRecord,
  type ChatVisualMode,
  type ChatVisualModeSyncRecordV2,
  type EnvironmentId,
} from "@t3tools/contracts";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { uuidv4 } from "../lib/uuid";
import {
  createMobileChatVisualModeRecord,
  mobileChatVisualModePreferencePatch,
  nextMobileChatVisualModeUpdatedAt,
} from "./chat-visual-mode-preference";
import {
  deriveMobileChatVisualModeSync,
  type MobileChatVisualModeSyncEnvironment,
} from "./chat-visual-mode-sync";
import { useEnvironments } from "./environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

export interface MobileChatVisualModeSyncState {
  readonly mode: ChatVisualMode;
  readonly isReady: boolean;
  readonly isSyncing: boolean;
  readonly isLocalOnly: boolean;
  readonly failedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly setMode: (mode: ChatVisualMode) => void;
}

function writeKey(record: ChatVisualModeSyncRecordV2, recordVersion = 1): string {
  return `${recordVersion}:${record.mode}:${record.updatedAt}:${record.updateId}`;
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
  left: ChatVisualModeSyncRecordV2 | null,
  right: ChatVisualModeSyncRecordV2 | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.mode === right.mode &&
      left.updatedAt === right.updatedAt &&
      left.updateId === right.updateId)
  );
}

export function useChatVisualModeSync(): MobileChatVisualModeSyncState {
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
  const localRecord = preferences?.chatVisualModeSyncRecord;
  const localRecordV2 = preferences?.chatVisualModeSyncRecordV2;

  const syncEnvironments = useMemo(
    (): readonly MobileChatVisualModeSyncEnvironment<EnvironmentId>[] =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        connected: environment.connection.phase === "connected",
        configLoaded: environment.serverConfig !== null,
        environmentSettingsVersion:
          environment.serverConfig?.environment.capabilities.environmentSettingsVersion,
        record: environment.serverConfig?.settings.chatVisualModeSyncRecord ?? null,
        recordV2: environment.serverConfig?.settings.chatVisualModeSyncRecordV2 ?? null,
      })),
    [environments],
  );

  const sync = useMemo(
    () =>
      deriveMobileChatVisualModeSync({
        preferencesReady,
        catalogReady,
        localRecord,
        localRecordV2,
        environments: syncEnvironments,
      }),
    [catalogReady, localRecord, localRecordV2, preferencesReady, syncEnvironments],
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
    const patchKey = writeKey(patch.chatVisualModeSyncRecordV2, 2);
    if (attemptedPreferencePatch.current === patchKey) return;
    attemptedPreferencePatch.current = patchKey;
    savePreferences(patch);
  }, [savePreferences, sync.preferencePatch]);

  useEffect(() => {
    if (!sync.isReady) return;
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
      const key = writeKey(write.record, write.recordVersion);
      if (attemptedWriteByEnvironment.current.get(write.environmentId) === key) return false;
      attemptedWriteByEnvironment.current.set(write.environmentId, key);
      return true;
    });
    if (writes.length === 0) return;

    const writeEnvironmentIds = writes.map((write) => write.environmentId);
    setIds(setInFlightEnvironmentIds, writeEnvironmentIds, []);

    void Promise.all(
      writes.map(async (write): Promise<ChatVisualModeSyncWriteOutcome<EnvironmentId> | null> => {
        const result = await updateServerSettings({
          environmentId: write.environmentId,
          input: { patch: chatVisualModeSyncWritePatch(write) },
        });
        if (
          attemptedWriteByEnvironment.current.get(write.environmentId) !==
          writeKey(write.record, write.recordVersion)
        ) {
          return null;
        }
        if (result._tag === "Success") {
          return { environmentId: write.environmentId, status: "success" };
        }
        return isAtomCommandInterrupted(result)
          ? null
          : { environmentId: write.environmentId, status: "failure" };
      }),
    ).then((results) => {
      const outcomes = results.filter(
        (outcome): outcome is ChatVisualModeSyncWriteOutcome<EnvironmentId> => outcome !== null,
      );
      const settlement = settleChatVisualModeSyncWrites(sync.plan, outcomes);
      setIds(
        setFailedEnvironmentIds,
        settlement.failedEnvironmentIds,
        settlement.successfulEnvironmentIds,
      );
      const completedEnvironmentIds = writes
        .filter(
          (write) =>
            attemptedWriteByEnvironment.current.get(write.environmentId) ===
            writeKey(write.record, write.recordVersion),
        )
        .map((write) => write.environmentId);
      setIds(setInFlightEnvironmentIds, [], completedEnvironmentIds);
    });
  }, [sync.isReady, sync.plan, syncEnvironments, updateServerSettings]);

  useEffect(() => {
    const winner = sync.plan.winner;
    if (winner === null) return;
    const synchronizedEnvironmentIds = syncEnvironments
      .filter(
        (environment) =>
          environment.connected &&
          recordMatches(
            resolveChatVisualModeRecord(environment.record, environment.recordV2),
            winner,
          ),
      )
      .map((environment) => environment.environmentId);
    setIds(setFailedEnvironmentIds, [], synchronizedEnvironmentIds);
  }, [sync.plan.winner, syncEnvironments]);

  const setMode = useCallback(
    (mode: ChatVisualMode) => {
      const updatedAt = nextMobileChatVisualModeUpdatedAt({
        now: Date.now(),
        winnerUpdatedAt: sync.plan.winner?.updatedAt,
        previousLocalUpdatedAt: lastLocalUpdatedAt.current,
      });
      lastLocalUpdatedAt.current = updatedAt;
      const record = createMobileChatVisualModeRecord(mode, updatedAt, `mobile:${uuidv4()}`);
      attemptedPreferencePatch.current = writeKey(record, 2);
      savePreferences(mobileChatVisualModePreferencePatch(record));
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
    mode: sync.mode,
    isReady: preferencesReady,
    isSyncing: inFlightEnvironmentIds.length > 0,
    isLocalOnly: !syncEnvironments.some(
      (environment) => environment.connected && environment.configLoaded,
    ),
    failedEnvironmentLabels,
    deferredEnvironmentLabels: sync.deferredEnvironmentLabels,
    unsupportedEnvironmentLabels: sync.unsupportedEnvironmentLabels,
    setMode,
  };
}
