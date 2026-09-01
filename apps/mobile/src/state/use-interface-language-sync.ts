import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  createInterfaceLocaleCompatibilityMirror,
  resolveInterfaceLocaleSyncRecord,
} from "@t3tools/client-runtime/interface-language-sync";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  InterfaceLocalePreferenceV1,
  InterfaceLocaleSyncRecordV1,
} from "@t3tools/contracts";
import {
  resolveInterfaceLocale,
  type ResolvedInterfaceLanguage,
} from "@t3tools/shared/interfaceLanguage";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";

import { uuidv4 } from "../lib/uuid";
import {
  createMobileInterfaceLocaleRecordV1,
  mobileInterfaceLocalePreferencePatch,
  nextMobileInterfaceLanguageUpdatedAt,
} from "./interface-language-preference";
import {
  deriveMobileInterfaceLanguageSync,
  mobileInterfaceLanguageSyncWrites,
  settleMobileInterfaceLanguageSyncWrites,
  type MobileInterfaceLanguageSyncEnvironment,
  type MobileInterfaceLanguageSyncWrite,
  type MobileInterfaceLanguageSyncWriteOutcome,
} from "./interface-language-sync";
import { useEnvironments } from "./environments";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "./preferences";
import { serverEnvironment } from "./server";
import { useAtomCommand } from "./use-atom-command";

export interface MobileInterfaceLanguageSyncState {
  readonly preference: InterfaceLocalePreferenceV1;
  readonly language: ResolvedInterfaceLanguage;
  readonly locale: string;
  readonly isReady: boolean;
  readonly isSyncing: boolean;
  readonly failedEnvironmentLabels: readonly string[];
  readonly deferredEnvironmentLabels: readonly string[];
  readonly unsupportedEnvironmentLabels: readonly string[];
  readonly setPreference: (preference: InterfaceLocalePreferenceV1) => void;
}

function writeKey(write: MobileInterfaceLanguageSyncWrite<EnvironmentId>): string {
  return `${write.kind}:${write.record.updatedAt}:${write.record.updateId}`;
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

function setIds(
  setter: (update: (current: readonly EnvironmentId[]) => readonly EnvironmentId[]) => void,
  additions: readonly EnvironmentId[],
  removals: readonly EnvironmentId[],
): void {
  setter((current) => {
    const next = updateIds(current, additions, removals);
    return current.length === next.length && current.every((id, index) => id === next[index])
      ? current
      : next;
  });
}

function recordMatches(
  left: InterfaceLocaleSyncRecordV1 | null,
  right: InterfaceLocaleSyncRecordV1 | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.version === right.version &&
      left.preference === right.preference &&
      left.updatedAt === right.updatedAt &&
      left.updateId === right.updateId)
  );
}

function readSystemLocales(): readonly string[] {
  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    return locale ? [locale] : [];
  } catch {
    return [];
  }
}

export function useInterfaceLanguageSync(): MobileInterfaceLanguageSyncState {
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
  const [systemLocales, setSystemLocales] = useState(readSystemLocales);
  const attemptedWriteByEnvironment = useRef(new Map<EnvironmentId, string>());
  const attemptedPreferencePatch = useRef<string | null>(null);
  const lastLocalUpdatedAt = useRef(0);

  const preferencesReady = AsyncResult.isSuccess(preferencesResult) && !preferencesResult.waiting;
  const preferences = AsyncResult.isSuccess(preferencesResult) ? preferencesResult.value : null;
  const localLocaleRecord = preferences?.interfaceLocaleSyncRecordV1;
  const localLegacyRecord = preferences?.interfaceLanguageSyncRecord ?? null;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setSystemLocales(readSystemLocales());
    });
    return () => subscription.remove();
  }, []);

  const syncEnvironments = useMemo(
    (): readonly MobileInterfaceLanguageSyncEnvironment<EnvironmentId>[] =>
      environments.map((environment) => ({
        environmentId: environment.environmentId,
        label: environment.label,
        connected: environment.connection.phase === "connected",
        configLoaded: environment.serverConfig !== null,
        environmentSettingsVersion:
          environment.serverConfig?.environment.capabilities.environmentSettingsVersion,
        localeRecord: environment.serverConfig?.settings.interfaceLocaleSyncRecordV1 ?? null,
        legacyRecord: environment.serverConfig?.settings.interfaceLanguageSyncRecord ?? null,
      })),
    [environments],
  );

  const sync = useMemo(
    () =>
      deriveMobileInterfaceLanguageSync({
        preferencesReady,
        catalogReady,
        localLocaleRecord,
        localLegacyRecord,
        environments: syncEnvironments,
      }),
    [catalogReady, localLegacyRecord, localLocaleRecord, preferencesReady, syncEnvironments],
  );
  const resolved = useMemo(
    () => resolveInterfaceLocale(sync.preference, systemLocales),
    [sync.preference, systemLocales],
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
    const patchKey = patch.interfaceLocaleSyncRecordV1.updateId;
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

    const writes = mobileInterfaceLanguageSyncWrites(sync.plan).filter((write) => {
      const key = writeKey(write);
      if (attemptedWriteByEnvironment.current.get(write.environmentId) === key) return false;
      attemptedWriteByEnvironment.current.set(write.environmentId, key);
      return true;
    });
    if (writes.length === 0) return;

    const writeEnvironmentIds = writes.map((write) => write.environmentId);
    setIds(setInFlightEnvironmentIds, writeEnvironmentIds, []);

    void Promise.all(
      writes.map(
        async (write): Promise<MobileInterfaceLanguageSyncWriteOutcome<EnvironmentId> | null> => {
          const environment = syncEnvironments.find(
            (candidate) => candidate.environmentId === write.environmentId,
          );
          const legacyMirror =
            write.kind === "locale"
              ? createInterfaceLocaleCompatibilityMirror(
                  write.record,
                  environment?.legacyRecord ?? null,
                )
              : write.record;
          const result = await updateServerSettings({
            environmentId: write.environmentId,
            input: {
              patch:
                write.kind === "locale"
                  ? {
                      interfaceLocaleSyncRecordV1: write.record,
                      ...(legacyMirror === null
                        ? {}
                        : { interfaceLanguageSyncRecord: legacyMirror }),
                    }
                  : { interfaceLanguageSyncRecord: write.record },
            },
          });
          if (attemptedWriteByEnvironment.current.get(write.environmentId) !== writeKey(write)) {
            return null;
          }
          if (result._tag === "Success") {
            return { kind: write.kind, environmentId: write.environmentId, status: "success" };
          }
          return isAtomCommandInterrupted(result)
            ? null
            : { kind: write.kind, environmentId: write.environmentId, status: "failure" };
        },
      ),
    ).then((results) => {
      const outcomes = results.filter(
        (outcome): outcome is MobileInterfaceLanguageSyncWriteOutcome<EnvironmentId> =>
          outcome !== null,
      );
      const settlement = settleMobileInterfaceLanguageSyncWrites(sync.plan, outcomes);
      setIds(
        setFailedEnvironmentIds,
        settlement.failedEnvironmentIds,
        settlement.successfulEnvironmentIds,
      );
      setIds(setInFlightEnvironmentIds, [], writeEnvironmentIds);
    });
  }, [sync.plan, syncEnvironments, updateServerSettings]);

  useEffect(() => {
    const winner = sync.plan.winner;
    if (winner === null) return;
    const synchronizedEnvironmentIds = syncEnvironments
      .filter(
        (environment) =>
          environment.connected &&
          recordMatches(
            resolveInterfaceLocaleSyncRecord({
              localeRecord: environment.localeRecord,
              legacyRecord: environment.legacyRecord,
            }),
            winner,
          ),
      )
      .map((environment) => environment.environmentId);
    setIds(setFailedEnvironmentIds, [], synchronizedEnvironmentIds);
  }, [sync.plan.winner, syncEnvironments]);

  const setPreference = useCallback(
    (preference: InterfaceLocalePreferenceV1) => {
      const updatedAt = nextMobileInterfaceLanguageUpdatedAt({
        now: Date.now(),
        winnerUpdatedAt: sync.plan.winner?.updatedAt,
        previousLocalUpdatedAt: lastLocalUpdatedAt.current,
      });
      lastLocalUpdatedAt.current = updatedAt;
      const record = createMobileInterfaceLocaleRecordV1(
        preference,
        updatedAt,
        `mobile:${uuidv4()}`,
      );
      const legacyMirror = createInterfaceLocaleCompatibilityMirror(record, localLegacyRecord);
      attemptedPreferencePatch.current = record.updateId;
      savePreferences(
        mobileInterfaceLocalePreferencePatch(
          record,
          legacyMirror === null ? undefined : legacyMirror,
        ),
      );
      setFailedEnvironmentIds([]);
    },
    [localLegacyRecord, savePreferences, sync.plan.winner?.updatedAt],
  );

  const failedEnvironmentLabels = useMemo(
    () =>
      failedEnvironmentIds.map(
        (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
      ),
    [failedEnvironmentIds, labelByEnvironmentId],
  );

  return {
    preference: sync.preference,
    language: resolved.language,
    locale: resolved.locale,
    isReady: sync.isReady,
    isSyncing: inFlightEnvironmentIds.length > 0,
    failedEnvironmentLabels,
    deferredEnvironmentLabels: sync.deferredEnvironmentLabels,
    unsupportedEnvironmentLabels: sync.unsupportedEnvironmentLabels,
    setPreference,
  };
}
