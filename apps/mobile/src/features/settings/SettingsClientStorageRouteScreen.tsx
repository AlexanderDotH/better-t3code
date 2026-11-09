import * as Dialog from "../../components/ui/Dialog";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { type EnvironmentMachineKind, resolveEnvironmentMachineKind } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { useMemo } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/ui/AppText";
import { SymbolView } from "../../components/ui/AppSymbol";
import { ENVIRONMENT_MACHINE_SYMBOLS } from "../../components/EnvironmentMachineSymbol";
import {
  clearClientCacheAtom,
  clientCacheSummaryAtom,
  type EnvironmentClientCacheSummary,
} from "../../state/client-cache-state";
import { useServerConfigs } from "../../state/entities";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { ListActionRow as SettingsActionRow } from "../../components/ui/ListActionRow";
import { SettingsSection } from "./components/SettingsSection";
import { SettingsScreen } from "./components/SettingsScreen";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function SettingsClientStorageRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const summaryResult = useAtomValue(clientCacheSummaryAtom);
  const clearResult = useAtomValue(clearClientCacheAtom);
  const clearCache = useAtomSet(clearClientCacheAtom);
  const { savedConnectionsById } = useSavedRemoteConnections();
  const serverConfigs = useServerConfigs();
  const isClearing = clearResult.waiting;
  const summary = AsyncResult.isSuccess(summaryResult) ? summaryResult.value : null;
  const environmentSummaries = useMemo(
    () =>
      [...(summary?.environments ?? [])].sort((left, right) => {
        const leftLabel = savedConnectionsById[left.environmentId]?.environmentLabel ?? "";
        const rightLabel = savedConnectionsById[right.environmentId]?.environmentLabel ?? "";
        return leftLabel.localeCompare(rightLabel);
      }),
    [savedConnectionsById, summary?.environments],
  );

  const confirmClearEnvironment = (environment: EnvironmentClientCacheSummary) => {
    const label =
      savedConnectionsById[environment.environmentId]?.environmentLabel ??
      environment.environmentId;
    Dialog.confirm({
      title: `Clear cache for ${label}?`,
      message: translator.message("mobile.settings.storage.clearEnvironmentDescription"),
      confirmText: translator.message("mobile.settings.storage.clearCache"),
      destructive: true,
      onConfirm: () =>
        clearCache({ type: "environment", environmentId: environment.environmentId }),
    });
  };

  const confirmClearAll = () => {
    Dialog.confirm({
      title: translator.message("mobile.settings.storage.clearAllTitle"),
      message: translator.message("mobile.settings.storage.clearAllDescription"),
      confirmText: translator.message("mobile.settings.storage.clearAll"),
      destructive: true,
      onConfirm: () => clearCache({ type: "all" }),
    });
  };

  return (
    <SettingsScreen title={translator.message("mobile.ui.clientStorage")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentInset={{ bottom: Math.max(insets.bottom, 18) }}
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4 pb-[18px]"
      >
        <SettingsSection title={translator.message("mobile.settings.storage.environmentCaches")}>
          {AsyncResult.isFailure(summaryResult) ? (
            <View className="items-center gap-2 px-6 py-8">
              <SymbolView
                name="exclamationmark.triangle"
                size={28}
                tintColorClassName="accent-danger-foreground"
                type="monochrome"
                weight="regular"
              />
              <Text className="text-center text-base text-foreground">
                {translator.message("mobile.settings.storage.unavailable")}
              </Text>
              <Text className="text-center text-sm text-foreground-muted">
                {translator.message("mobile.settings.storage.restart")}
              </Text>
            </View>
          ) : !summary ? (
            <View className="items-center gap-3 px-6 py-8">
              <AppActivityIndicator />
              <Text className="text-center text-sm text-foreground-muted">
                {translator.message("mobile.settings.storage.inspecting")}
              </Text>
            </View>
          ) : environmentSummaries.length > 0 ? (
            environmentSummaries.map((environment, index) => (
              <CacheEnvironmentRow
                key={environment.environmentId}
                environment={environment}
                environmentLabel={
                  savedConnectionsById[environment.environmentId]?.environmentLabel ??
                  environment.environmentId
                }
                machine={resolveEnvironmentMachineKind(
                  serverConfigs.get(environment.environmentId) ?? null,
                )}
                disabled={isClearing}
                first={index === 0}
                onClear={() => confirmClearEnvironment(environment)}
              />
            ))
          ) : (
            <View className="items-center gap-2 px-6 py-8">
              <SymbolView
                name="checkmark.circle"
                size={28}
                tintColorClassName="accent-icon"
                type="monochrome"
                weight="regular"
              />
              <Text className="text-center text-base text-foreground">
                {translator.message("mobile.settings.storage.none")}
              </Text>
              <Text className="text-center text-sm text-foreground-muted">
                {translator.message("mobile.settings.storage.noneDescription")}
              </Text>
            </View>
          )}
        </SettingsSection>

        <View className="gap-3">
          <SettingsSection title={translator.message("mobile.settings.storage.actions")}>
            <SettingsActionRow
              icon="trash"
              label={
                summary
                  ? `Clear ${formatBytes(summary.payloadBytes)}`
                  : translator.message("mobile.settings.storage.clearCaches")
              }
              tone="danger"
              disabled={isClearing || !summary || summary.recordCount === 0}
              loading={isClearing}
              onPress={confirmClearAll}
            />
          </SettingsSection>
          <Text className="px-2 text-sm leading-normal text-foreground-muted">
            {translator.message("mobile.settings.storage.safety")}
          </Text>
          {AsyncResult.isFailure(summaryResult) || AsyncResult.isFailure(clearResult) ? (
            <Text selectable className="px-2 text-sm text-danger-foreground">
              {translator.message("mobile.settings.storage.temporaryUnavailable")}
            </Text>
          ) : null}
        </View>
      </ScrollView>
    </SettingsScreen>
  );
}

function CacheEnvironmentRow(props: {
  readonly environment: EnvironmentClientCacheSummary;
  readonly environmentLabel: string;
  readonly machine: EnvironmentMachineKind;
  readonly disabled: boolean;
  readonly first: boolean;
  readonly onClear: () => void;
}) {
  return (
    <View className={props.first ? undefined : "border-t border-border"}>
      <SettingsActionRow
        icon={ENVIRONMENT_MACHINE_SYMBOLS[props.machine]}
        label={props.environmentLabel}
        description={`Clear ${formatBytes(props.environment.payloadBytes)} of cached data`}
        tone="danger"
        disabled={props.disabled}
        onPress={props.onClear}
      />
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
