import {
  type EnvironmentId,
  DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1,
  type InterfaceLocalePreferenceV1,
  type InterfaceLocaleSyncRecordV1,
} from "@t3tools/contracts";
import {
  createInterfaceLocaleCompatibilityMirror,
  planInterfaceLocaleCompatibilitySync,
  resolveInterfaceLocaleSyncRecord,
  settleInterfaceLanguageSyncWrites,
  settleInterfaceLocaleSyncWrites,
  type InterfaceLanguageSyncWrite,
  type InterfaceLocaleSyncWrite,
} from "@t3tools/client-runtime/interface-language-sync";
import {
  resolveInterfaceLocale,
  translateInterfaceMessage,
  type ResolvedInterfaceLanguage,
  type ResolvedInterfaceLocale,
} from "@t3tools/shared/interfaceLanguage";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  useClientSettings,
  useClientSettingsHydrated,
  useUpdateClientSettings,
} from "./hooks/useSettings";
import { randomUUID } from "./lib/utils";
import { setInterfaceLocaleRuntime } from "./interfaceLanguageRuntime";
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
  preference: InterfaceLocalePreferenceV1,
  clock: InterfaceLanguageUpdateClock = DEFAULT_UPDATE_CLOCK,
  previousUpdatedAt = -1,
): InterfaceLocaleSyncRecordV1 {
  const updatedAt = Math.max(clock.now(), previousUpdatedAt + 1, latestObservedUpdatedAt + 1);
  latestObservedUpdatedAt = updatedAt;
  return { version: 1, preference, updatedAt, updateId: clock.updateId() };
}

export const INTERFACE_LANGUAGE_PREFERENCES = [
  "system",
  "en",
  "de",
  "fr",
] as const satisfies ReadonlyArray<InterfaceLocalePreferenceV1>;

export function isInterfaceLanguagePreference(
  value: unknown,
): value is InterfaceLocalePreferenceV1 {
  return (
    typeof value === "string" &&
    INTERFACE_LANGUAGE_PREFERENCES.some((preference) => preference === value)
  );
}

export function interfaceLanguagePreferenceMessageId(
  preference: InterfaceLocalePreferenceV1,
):
  | "settings.interfaceLanguage.system"
  | "settings.interfaceLanguage.english"
  | "settings.interfaceLanguage.german"
  | "settings.interfaceLanguage.french" {
  switch (preference) {
    case "system":
      return "settings.interfaceLanguage.system";
    case "en":
      return "settings.interfaceLanguage.english";
    case "de":
      return "settings.interfaceLanguage.german";
    case "fr":
      return "settings.interfaceLanguage.french";
  }
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
  readonly preference: InterfaceLocalePreferenceV1;
}

export function useInterfaceLanguage(): InterfaceLanguageState {
  const localeRecord = useClientSettings((settings) => settings.interfaceLocaleLocalRecordV1);
  const legacyRecord = useClientSettings((settings) => settings.interfaceLanguageLocalRecord);
  const systemLocales = useSystemInterfaceLocales();
  const record = resolveInterfaceLocaleSyncRecord({ localeRecord, legacyRecord });
  const preference = record?.preference ?? DEFAULT_INTERFACE_LOCALE_PREFERENCE_V1;
  return useMemo(
    () => ({ preference, ...resolveInterfaceLocale(preference, systemLocales) }),
    [preference, systemLocales],
  );
}

export function useSetInterfaceLanguagePreference(): (
  preference: InterfaceLocalePreferenceV1,
) => void {
  const localeRecord = useClientSettings((settings) => settings.interfaceLocaleLocalRecordV1);
  const legacyRecord = useClientSettings((settings) => settings.interfaceLanguageLocalRecord);
  const updateClientSettings = useUpdateClientSettings();
  return useCallback(
    (preference: InterfaceLocalePreferenceV1) => {
      const effectiveRecord = resolveInterfaceLocaleSyncRecord({ localeRecord, legacyRecord });
      const nextRecord = createInterfaceLanguageSyncRecord(
        preference,
        DEFAULT_UPDATE_CLOCK,
        effectiveRecord?.updatedAt,
      );
      updateClientSettings({
        interfaceLocaleLocalRecordV1: nextRecord,
        interfaceLanguageLocalRecord: createInterfaceLocaleCompatibilityMirror(
          nextRecord,
          legacyRecord,
        ),
      });
    },
    [legacyRecord, localeRecord, updateClientSettings],
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
  const conjunction = language === "de" ? " und " : language === "fr" ? " et " : " and ";
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

interface InterfaceSyncRecordIdentity {
  readonly preference: string;
  readonly updatedAt: number;
  readonly updateId: string;
}

function recordsMatch(
  left: InterfaceSyncRecordIdentity | null,
  right: InterfaceSyncRecordIdentity | null,
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

type InterfaceSyncWrite =
  | InterfaceLanguageSyncWrite<EnvironmentId>
  | InterfaceLocaleSyncWrite<EnvironmentId>;

function writeKey(schema: "locale" | "legacy", write: InterfaceSyncWrite): string {
  return [
    schema,
    write.environmentId,
    write.record.updatedAt,
    write.record.updateId,
    write.record.preference,
  ].join(":");
}

function writesMatch<Write extends InterfaceSyncWrite>(
  schema: "locale" | "legacy",
  left: readonly Write[],
  right: readonly Write[],
): boolean {
  return (
    left.length === right.length &&
    left.every((write, index) => writeKey(schema, write) === writeKey(schema, right[index]!))
  );
}

type PlannedInterfaceSyncWrite =
  | { readonly schema: "locale"; readonly write: InterfaceLocaleSyncWrite<EnvironmentId> }
  | { readonly schema: "legacy"; readonly write: InterfaceLanguageSyncWrite<EnvironmentId> };

export function InterfaceLanguageSyncCoordinator() {
  const localLocaleRecord = useClientSettings((settings) => settings.interfaceLocaleLocalRecordV1);
  const localLegacyRecord = useClientSettings((settings) => settings.interfaceLanguageLocalRecord);
  const settingsHydrated = useClientSettingsHydrated();
  const updateClientSettings = useUpdateClientSettings();
  const interfaceLocale = useInterfaceLanguage();
  const { environments, isReady } = useEnvironments();
  const persistServerSettings = useAtomCommand(serverEnvironment.updateSettings, {
    label: "interface language settings sync",
    reportFailure: false,
  });
  const [pendingLocaleWrites, setPendingLocaleWrites] = useState<
    readonly InterfaceLocaleSyncWrite<EnvironmentId>[]
  >([]);
  const [pendingLegacyWrites, setPendingLegacyWrites] = useState<
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
            localeRecord: config.settings.interfaceLocaleSyncRecordV1 ?? null,
            legacyRecord: config.settings.interfaceLanguageSyncRecord ?? null,
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
      planInterfaceLocaleCompatibilitySync<EnvironmentId>({
        localLocaleRecord,
        localLegacyRecord,
        environments: syncEnvironments,
        pendingLocaleWrites,
        pendingLegacyWrites,
      }),
    [
      localLegacyRecord,
      localLocaleRecord,
      pendingLegacyWrites,
      pendingLocaleWrites,
      syncEnvironments,
    ],
  );
  const plannedWrites = useMemo<readonly PlannedInterfaceSyncWrite[]>(
    () => [
      ...plan.localePlan.writes.map((write) => ({ schema: "locale" as const, write })),
      ...plan.legacyPlan.writes.map((write) => ({ schema: "legacy" as const, write })),
    ],
    [plan.legacyPlan.writes, plan.localePlan.writes],
  );
  const pendingWrites = useMemo<readonly PlannedInterfaceSyncWrite[]>(
    () => [
      ...plan.localePlan.pendingWrites.map((write) => ({ schema: "locale" as const, write })),
      ...plan.legacyPlan.pendingWrites.map((write) => ({ schema: "legacy" as const, write })),
    ],
    [plan.legacyPlan.pendingWrites, plan.localePlan.pendingWrites],
  );

  useEffect(() => {
    if (plan.winner !== null) {
      latestObservedUpdatedAt = Math.max(latestObservedUpdatedAt, plan.winner.updatedAt);
    }
  }, [plan.winner]);

  useLayoutEffect(() => {
    setInterfaceLocaleRuntime(interfaceLocale);
    document.documentElement.lang = interfaceLocale.locale;
  }, [interfaceLocale]);

  useEffect(() => {
    const connectedEnvironmentIds = new Set(
      syncEnvironments
        .filter((environment) => environment.connected)
        .map((environment) => environment.environmentId),
    );
    const pendingWriteKeyByEnvironment = new Map(
      pendingWrites.map(
        ({ schema, write }) => [write.environmentId, writeKey(schema, write)] as const,
      ),
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
  }, [pendingWrites, syncEnvironments]);

  useEffect(() => {
    const plannedWriteKeys = new Set(
      plannedWrites.map(({ schema, write }) => writeKey(schema, write)),
    );
    for (const key of confirmedWriteKeys.current) {
      if (!plannedWriteKeys.has(key)) confirmedWriteKeys.current.delete(key);
    }
  }, [plannedWrites]);

  const status = useMemo<InterfaceLanguageSyncStatus>(() => {
    const labelsFor = (environmentIds: readonly EnvironmentId[]) =>
      environmentIds.map(
        (environmentId) => labelByEnvironmentId.get(environmentId) ?? environmentId,
      );
    const failedEnvironmentIds = pendingWrites
      .filter(
        ({ schema, write }) =>
          failedWriteKeyByEnvironment.get(write.environmentId) === writeKey(schema, write),
      )
      .map(({ write }) => write.environmentId);
    const isSyncing = plannedWrites.some(({ schema, write }) => {
      const key = writeKey(schema, write);
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

    if (
      !recordsMatch(localLocaleRecord, plan.nextLocalLocaleRecord) ||
      !recordsMatch(localLegacyRecord, plan.nextLocalLegacyRecord)
    ) {
      updateClientSettings({
        interfaceLocaleLocalRecordV1: plan.nextLocalLocaleRecord,
        interfaceLanguageLocalRecord: plan.nextLocalLegacyRecord,
      });
    }
    setPendingLocaleWrites((current) =>
      writesMatch("locale", current, plan.localePlan.pendingWrites)
        ? current
        : plan.localePlan.pendingWrites,
    );
    setPendingLegacyWrites((current) =>
      writesMatch("legacy", current, plan.legacyPlan.pendingWrites)
        ? current
        : plan.legacyPlan.pendingWrites,
    );

    const writes = plannedWrites.filter(({ schema, write }) => {
      const key = writeKey(schema, write);
      return (
        !activeWriteKeys.current.has(key) &&
        !confirmedWriteKeys.current.has(key) &&
        failedWriteKeyByEnvironment.get(write.environmentId) !== key
      );
    });
    if (writes.length === 0) return;

    for (const { schema, write } of writes) {
      activeWriteKeys.current.add(writeKey(schema, write));
    }
    void Promise.all(
      writes.map(async ({ schema, write }) => {
        const result = await persistServerSettings({
          environmentId: write.environmentId,
          input: {
            patch:
              schema === "locale"
                ? { interfaceLocaleSyncRecordV1: write.record }
                : { interfaceLanguageSyncRecord: write.record },
          },
        });
        return {
          schema,
          write,
          environmentId: write.environmentId,
          status: result._tag === "Success" ? ("success" as const) : ("failure" as const),
        };
      }),
    ).then((outcomes) => {
      for (const { schema, write } of writes) {
        activeWriteKeys.current.delete(writeKey(schema, write));
      }
      if (!mounted.current) return;

      const localeOutcomes = outcomes
        .filter((outcome) => outcome.schema === "locale")
        .map(({ environmentId, status }) => ({ environmentId, status }));
      const legacyOutcomes = outcomes
        .filter((outcome) => outcome.schema === "legacy")
        .map(({ environmentId, status }) => ({ environmentId, status }));
      const localeSettlement = settleInterfaceLocaleSyncWrites(plan.localePlan, localeOutcomes);
      const legacySettlement = settleInterfaceLanguageSyncWrites(plan.legacyPlan, legacyOutcomes);
      for (const outcome of outcomes) {
        if (outcome.status === "success") {
          confirmedWriteKeys.current.add(writeKey(outcome.schema, outcome.write));
        }
      }
      setPendingLocaleWrites((current) =>
        writesMatch("locale", current, localeSettlement.pendingWrites)
          ? current
          : localeSettlement.pendingWrites,
      );
      setPendingLegacyWrites((current) =>
        writesMatch("legacy", current, legacySettlement.pendingWrites)
          ? current
          : legacySettlement.pendingWrites,
      );
      setFailedWriteKeyByEnvironment((current) => {
        const next = new Map(current);
        for (const outcome of outcomes) {
          if (outcome.status === "failure") {
            next.set(outcome.environmentId, writeKey(outcome.schema, outcome.write));
          }
          if (outcome.status === "success") next.delete(outcome.environmentId);
        }
        return next;
      });
    });
  }, [
    failedWriteKeyByEnvironment,
    isReady,
    localLegacyRecord,
    localLocaleRecord,
    plannedWrites,
    persistServerSettings,
    plan,
    settingsHydrated,
    updateClientSettings,
  ]);

  return null;
}
