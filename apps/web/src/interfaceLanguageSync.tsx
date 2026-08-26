import {
  type EnvironmentId,
  DEFAULT_INTERFACE_LANGUAGE_PREFERENCE,
  type InterfaceLanguagePreference,
  type InterfaceLanguageSyncRecord,
} from "@t3tools/contracts";
import {
  planInterfaceLanguageSync,
  settleInterfaceLanguageSyncWrites,
  type InterfaceLanguageSyncWrite,
} from "@t3tools/client-runtime/interface-language-sync";
import {
  resolveInterfaceLocale,
  translateInterfaceMessage,
  type ResolvedInterfaceLanguage,
  type ResolvedInterfaceLocale,
} from "@t3tools/shared/interfaceLanguage";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "./hooks/useSettings";
import { randomUUID } from "./lib/utils";
import { useEnvironments } from "./state/environments";
import { serverEnvironment } from "./state/server";
import { useAtomCommand } from "./state/use-atom-command";

interface InterfaceLanguageUpdateClock {
  readonly now: () => number;
  readonly updateId: () => string;
}

const DEFAULT_UPDATE_CLOCK: InterfaceLanguageUpdateClock = {
  now: Date.now,
  updateId: () => `web:${randomUUID()}`,
};

let latestObservedUpdatedAt = -1;

export function createInterfaceLanguageSyncRecord(
  preference: InterfaceLanguagePreference,
  clock: InterfaceLanguageUpdateClock = DEFAULT_UPDATE_CLOCK,
  previousUpdatedAt = -1,
): InterfaceLanguageSyncRecord {
  const updatedAt = Math.max(clock.now(), previousUpdatedAt + 1, latestObservedUpdatedAt + 1);
  latestObservedUpdatedAt = updatedAt;
  return { preference, updatedAt, updateId: clock.updateId() };
}

export function collectSystemInterfaceLocales(
  desktopSystemLocale: string | null | undefined,
  browserLanguages: readonly string[],
): readonly string[] {
  const locales: string[] = [];
  const hostLocale = desktopSystemLocale?.trim();
  if (hostLocale) locales.push(hostLocale);
  for (const locale of browserLanguages) {
    if (locale.trim() && !locales.includes(locale)) locales.push(locale);
  }
  return locales;
}

function readSystemInterfaceLocales(): readonly string[] {
  if (typeof window === "undefined") return [];
  return collectSystemInterfaceLocales(
    window.desktopBridge?.getSystemLocale?.(),
    navigator.languages.length > 0 ? navigator.languages : [navigator.language],
  );
}

function systemLocaleSnapshot(): string {
  return JSON.stringify(readSystemInterfaceLocales());
}

function subscribeSystemLocales(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("languagechange", onChange);
  return () => window.removeEventListener("languagechange", onChange);
}

function useSystemInterfaceLocales(): readonly string[] {
  const snapshot = useSyncExternalStore(subscribeSystemLocales, systemLocaleSnapshot, () => "[]");
  return useMemo(() => JSON.parse(snapshot) as readonly string[], [snapshot]);
}

export interface InterfaceLanguageState extends ResolvedInterfaceLocale {
  readonly preference: InterfaceLanguagePreference;
}

export function useInterfaceLanguage(): InterfaceLanguageState {
  const record = useClientSettings((settings) => settings.interfaceLanguageLocalRecord);
  const systemLocales = useSystemInterfaceLocales();
  const preference = record?.preference ?? DEFAULT_INTERFACE_LANGUAGE_PREFERENCE;
  return useMemo(
    () => ({ preference, ...resolveInterfaceLocale(preference, systemLocales) }),
    [preference, systemLocales],
  );
}

export function useSetInterfaceLanguagePreference(): (
  preference: InterfaceLanguagePreference,
) => void {
  const localRecord = useClientSettings((settings) => settings.interfaceLanguageLocalRecord);
  const updateClientSettings = useUpdateClientSettings();
  return useCallback(
    (preference: InterfaceLanguagePreference) => {
      updateClientSettings({
        interfaceLanguageLocalRecord: createInterfaceLanguageSyncRecord(
          preference,
          DEFAULT_UPDATE_CLOCK,
          localRecord?.updatedAt,
        ),
      });
    },
    [localRecord?.updatedAt, updateClientSettings],
  );
}

export interface InterfaceLanguageSyncStatus {
  readonly deferredEnvironmentLabels: readonly string[];
  readonly failedEnvironmentLabels: readonly string[];
  readonly isSyncing: boolean;
  readonly unsupportedEnvironmentLabels: readonly string[];
}

const EMPTY_SYNC_STATUS: InterfaceLanguageSyncStatus = Object.freeze({
  deferredEnvironmentLabels: Object.freeze([]),
  failedEnvironmentLabels: Object.freeze([]),
  isSyncing: false,
  unsupportedEnvironmentLabels: Object.freeze([]),
});
const syncStatusListeners = new Set<() => void>();
let syncStatusSnapshot = EMPTY_SYNC_STATUS;

function replaceSyncStatus(status: InterfaceLanguageSyncStatus): void {
  if (JSON.stringify(syncStatusSnapshot) === JSON.stringify(status)) return;
  syncStatusSnapshot = status;
  for (const listener of syncStatusListeners) listener();
}

function subscribeSyncStatus(listener: () => void): () => void {
  syncStatusListeners.add(listener);
  return () => syncStatusListeners.delete(listener);
}

export function useInterfaceLanguageSyncStatus(): InterfaceLanguageSyncStatus {
  return useSyncExternalStore(
    subscribeSyncStatus,
    () => syncStatusSnapshot,
    () => EMPTY_SYNC_STATUS,
  );
}

function formatEnvironmentLabels(
  language: ResolvedInterfaceLanguage,
  labels: readonly string[],
): string {
  if (labels.length <= 1) return labels[0] ?? "";
  const conjunction = language === "de" ? " und " : " and ";
  if (labels.length === 2) return `${labels[0]}${conjunction}${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}${conjunction}${labels.at(-1)}`;
}

export function interfaceLanguageSyncStatusText(
  language: ResolvedInterfaceLanguage,
  input: Omit<InterfaceLanguageSyncStatus, "isSyncing">,
): string | null {
  const messages: string[] = [];
  if (input.failedEnvironmentLabels.length > 0) {
    messages.push(
      translateInterfaceMessage(language, "settings.interfaceLanguage.syncFailed", {
        environments: formatEnvironmentLabels(language, input.failedEnvironmentLabels),
      }),
    );
  }
  if (input.unsupportedEnvironmentLabels.length > 0) {
    messages.push(
      translateInterfaceMessage(language, "settings.interfaceLanguage.syncUnsupported", {
        environments: formatEnvironmentLabels(language, input.unsupportedEnvironmentLabels),
      }),
    );
  }
  if (input.deferredEnvironmentLabels.length > 0) {
    messages.push(
      translateInterfaceMessage(language, "settings.interfaceLanguage.syncDeferred", {
        environments: formatEnvironmentLabels(language, input.deferredEnvironmentLabels),
      }),
    );
  }
  return messages.length > 0 ? messages.join(" ") : null;
}

function recordsMatch(
  left: InterfaceLanguageSyncRecord | null,
  right: InterfaceLanguageSyncRecord | null,
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.preference === right.preference &&
      left.updatedAt === right.updatedAt &&
      left.updateId === right.updateId)
  );
}

function writeKey(write: InterfaceLanguageSyncWrite<EnvironmentId>): string {
  return [
    write.environmentId,
    write.record.updatedAt,
    write.record.updateId,
    write.record.preference,
  ].join(":");
}

function writesMatch(
  left: readonly InterfaceLanguageSyncWrite<EnvironmentId>[],
  right: readonly InterfaceLanguageSyncWrite<EnvironmentId>[],
): boolean {
  return (
    left.length === right.length &&
    left.every((write, index) => writeKey(write) === writeKey(right[index]!))
  );
}

export function InterfaceLanguageSyncCoordinator() {
  const localRecord = useClientSettings((settings) => settings.interfaceLanguageLocalRecord);
  const settingsHydrated = useClientSettingsHydrated();
  const updateClientSettings = useUpdateClientSettings();
  const interfaceLocale = useInterfaceLanguage();
  const { environments, isReady } = useEnvironments();
  const persistServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "interface language settings sync",
    reportFailure: false,
  });
  const [pendingWrites, setPendingWrites] = useState<
    readonly InterfaceLanguageSyncWrite<EnvironmentId>[]
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
            record: config.settings.interfaceLanguageSyncRecord ?? null,
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
      planInterfaceLanguageSync<EnvironmentId>({
        localRecord,
        environments: syncEnvironments,
        pendingWrites,
      }),
    [localRecord, pendingWrites, syncEnvironments],
  );

  useEffect(() => {
    if (plan.winner !== null) {
      latestObservedUpdatedAt = Math.max(latestObservedUpdatedAt, plan.winner.updatedAt);
    }
  }, [plan.winner]);

  useEffect(() => {
    document.documentElement.lang = interfaceLocale.locale;
  }, [interfaceLocale.locale]);

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

  const status = useMemo<InterfaceLanguageSyncStatus>(() => {
    const labelsFor = (environmentIds: readonly EnvironmentId[]) =>
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

  useEffect(() => replaceSyncStatus(status), [status]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      replaceSyncStatus(EMPTY_SYNC_STATUS);
    };
  }, []);

  useEffect(() => {
    if (!settingsHydrated || !isReady || plan.winner === null) return;

    if (!recordsMatch(localRecord, plan.nextLocalRecord)) {
      updateClientSettings({ interfaceLanguageLocalRecord: plan.nextLocalRecord });
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
          input: { patch: { interfaceLanguageSyncRecord: write.record } },
        });
        return {
          environmentId: write.environmentId,
          status: result._tag === "Success" ? ("success" as const) : ("failure" as const),
        };
      }),
    ).then((outcomes) => {
      for (const write of writes) activeWriteKeys.current.delete(writeKey(write));
      if (!mounted.current) return;

      const settlement = settleInterfaceLanguageSyncWrites(plan, outcomes);
      for (const write of writes) {
        if (
          outcomes.some(
            (outcome) =>
              outcome.environmentId === write.environmentId && outcome.status === "success",
          )
        ) {
          confirmedWriteKeys.current.add(writeKey(write));
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
    });
  }, [
    failedWriteKeyByEnvironment,
    isReady,
    localRecord,
    persistServerSettings,
    plan,
    settingsHydrated,
    updateClientSettings,
  ]);

  return null;
}
