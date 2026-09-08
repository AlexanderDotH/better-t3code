import {
  type ChatVisualMode,
  ChatVisualModeSyncRecord as ChatVisualModeSyncRecordSchema,
  type ChatVisualModeSyncRecord,
  DEFAULT_CHAT_VISUAL_MODE,
  type EnvironmentId,
} from "@t3tools/contracts";
import {
  planChatVisualModeSync,
  settleChatVisualModeSyncWrites,
  type ChatVisualModeSyncWrite,
} from "@t3tools/client-runtime/chat-visual-mode-sync";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { toastManager } from "./components/ui/toast";
import { useLocalStorage } from "./hooks/useLocalStorage";
import { randomUUID } from "./lib/utils";
import { useEnvironments } from "./state/environments";
import { serverEnvironment } from "./state/server";
import { useAtomCommand } from "./state/use-atom-command";

export const CHAT_VISUAL_MODE_SYNC_STORAGE_KEY = "t3code:chat-visual-mode-sync:v1";

const ChatVisualModeSyncCache = Schema.NullOr(ChatVisualModeSyncRecordSchema);

interface ChatVisualModeUpdateClock {
  readonly now: () => number;
  readonly updateId: () => string;
}

function makeUpdateId(): string {
  return `web:${randomUUID()}`;
}

const DEFAULT_UPDATE_CLOCK: ChatVisualModeUpdateClock = {
  now: Date.now,
  updateId: makeUpdateId,
};

export function createChatVisualModeSyncRecord(
  mode: ChatVisualMode,
  clock: ChatVisualModeUpdateClock = DEFAULT_UPDATE_CLOCK,
  previousUpdatedAt = -1,
): ChatVisualModeSyncRecord {
  return {
    mode,
    updatedAt: Math.max(clock.now(), previousUpdatedAt + 1),
    updateId: clock.updateId(),
  };
}

export function resolveChatVisualMode(record: ChatVisualModeSyncRecord | null): ChatVisualMode {
  return record?.mode ?? DEFAULT_CHAT_VISUAL_MODE;
}

function formatEnvironmentLabels(labels: ReadonlyArray<string>): string {
  if (labels.length <= 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels.at(-1)}`;
}

export function chatVisualModeSyncStatusText(input: {
  readonly deferredEnvironmentLabels?: ReadonlyArray<string>;
  readonly failedEnvironmentLabels: ReadonlyArray<string>;
  readonly unsupportedEnvironmentLabels: ReadonlyArray<string>;
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

export interface ChatVisualModeSyncStatus {
  readonly deferredEnvironmentLabels: ReadonlyArray<string>;
  readonly failedEnvironmentLabels: ReadonlyArray<string>;
  readonly isSyncing: boolean;
  readonly unsupportedEnvironmentLabels: ReadonlyArray<string>;
}

const EMPTY_SYNC_STATUS: ChatVisualModeSyncStatus = Object.freeze({
  deferredEnvironmentLabels: Object.freeze([]),
  failedEnvironmentLabels: Object.freeze([]),
  isSyncing: false,
  unsupportedEnvironmentLabels: Object.freeze([]),
});
const syncStatusListeners = new Set<() => void>();
let syncStatusSnapshot = EMPTY_SYNC_STATUS;

function syncStatusKey(status: ChatVisualModeSyncStatus): string {
  return JSON.stringify(status);
}

function replaceSyncStatus(status: ChatVisualModeSyncStatus): void {
  if (syncStatusKey(syncStatusSnapshot) === syncStatusKey(status)) return;
  syncStatusSnapshot = status;
  for (const listener of syncStatusListeners) listener();
}

function subscribeSyncStatus(listener: () => void): () => void {
  syncStatusListeners.add(listener);
  return () => syncStatusListeners.delete(listener);
}

export function useChatVisualModeSyncStatus(): ChatVisualModeSyncStatus {
  return useSyncExternalStore(
    subscribeSyncStatus,
    () => syncStatusSnapshot,
    () => EMPTY_SYNC_STATUS,
  );
}

function recordsMatch(
  left: ChatVisualModeSyncRecord | null,
  right: ChatVisualModeSyncRecord | null,
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

function writeKey(write: ChatVisualModeSyncWrite<EnvironmentId>): string {
  return [
    write.environmentId,
    write.record.updatedAt,
    write.record.updateId,
    write.record.mode,
  ].join(":");
}

function writesMatch(
  left: ReadonlyArray<ChatVisualModeSyncWrite<EnvironmentId>>,
  right: ReadonlyArray<ChatVisualModeSyncWrite<EnvironmentId>>,
): boolean {
  return (
    left.length === right.length &&
    left.every((write, index) => writeKey(write) === writeKey(right[index]!))
  );
}

function useChatVisualModeSyncCache() {
  return useLocalStorage(CHAT_VISUAL_MODE_SYNC_STORAGE_KEY, null, ChatVisualModeSyncCache);
}

export function useChatVisualMode(): ChatVisualMode {
  const [record] = useChatVisualModeSyncCache();
  return resolveChatVisualMode(record);
}

export function useSetChatVisualMode(): (mode: ChatVisualMode) => void {
  const [, setRecord] = useChatVisualModeSyncCache();
  return useCallback(
    (mode: ChatVisualMode) => {
      setRecord((current) =>
        createChatVisualModeSyncRecord(mode, DEFAULT_UPDATE_CLOCK, current?.updatedAt),
      );
    },
    [setRecord],
  );
}

export function ChatVisualModeSyncCoordinator() {
  const [localRecord, setLocalRecord] = useChatVisualModeSyncCache();
  const { environments, isReady } = useEnvironments();
  const persistServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "chat visual mode settings sync",
    reportFailure: false,
  });
  const [pendingWrites, setPendingWrites] = useState<
    ReadonlyArray<ChatVisualModeSyncWrite<EnvironmentId>>
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
            record: config.settings.chatVisualModeSyncRecord ?? null,
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
      planChatVisualModeSync<EnvironmentId>({
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

  const status = useMemo<ChatVisualModeSyncStatus>(() => {
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
    if (!isReady || plan.winner === null) return;

    if (!recordsMatch(localRecord, plan.nextLocalRecord)) {
      setLocalRecord(plan.nextLocalRecord);
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
          input: { patch: { chatVisualModeSyncRecord: write.record } },
        });
        return {
          environmentId: write.environmentId,
          status: result._tag === "Success" ? ("success" as const) : ("failure" as const),
        };
      }),
    ).then((outcomes) => {
      for (const write of writes) activeWriteKeys.current.delete(writeKey(write));
      if (!mounted.current) return;

      const settlement = settleChatVisualModeSyncWrites(plan, outcomes);
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

      if (settlement.failedEnvironmentIds.length === 0) return;

      const failedEnvironmentLabels = settlement.failedEnvironmentIds.map(
        (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
      );
      toastManager.add({
        type: "error",
        title: settlement.hasPartialFailure
          ? "Some servers didn’t sync"
          : "Chat visuals didn’t sync",
        description:
          chatVisualModeSyncStatusText({
            failedEnvironmentLabels,
            unsupportedEnvironmentLabels: [],
          }) ?? undefined,
      });
    });
  }, [
    failedWriteKeyByEnvironment,
    isReady,
    labelByEnvironmentId,
    localRecord,
    persistServerSettings,
    plan,
    setLocalRecord,
  ]);

  return null;
}
