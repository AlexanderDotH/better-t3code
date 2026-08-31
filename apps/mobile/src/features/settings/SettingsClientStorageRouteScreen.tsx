import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { useMemo } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppText as Text } from "../../components/AppText";
import { SymbolView } from "../../components/AppSymbol";
import {
  clearClientCacheAtom,
  clientCacheSummaryAtom,
  type EnvironmentClientCacheSummary,
} from "../../state/client-cache-state";
import { useSavedRemoteConnections } from "../../state/use-remote-environment-registry";
import { SettingsSection } from "./components/SettingsSection";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function SettingsClientStorageRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const summaryResult = useAtomValue(clientCacheSummaryAtom);
  const clearResult = useAtomValue(clearClientCacheAtom);
  const clearCache = useAtomSet(clearClientCacheAtom);
  const { savedConnectionsById } = useSavedRemoteConnections();
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
    Alert.alert(
      translator.message("mobile.settings.storage.clearEnvironmentTitle", {
        environment: label,
      }),
      translator.message("mobile.settings.storage.clearEnvironmentDescription"),
      [
        { text: translator.message("common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.settings.storage.clearCache"),
          style: "destructive",
          onPress: () =>
            clearCache({ type: "environment", environmentId: environment.environmentId }),
        },
      ],
    );
  };

  const confirmClearAll = () => {
    Alert.alert(
      translator.message("mobile.settings.storage.clearAllTitle"),
      translator.message("mobile.settings.storage.clearAllDescription"),
      [
        { text: translator.message("common.cancel"), style: "cancel" },
        {
          text: translator.message("mobile.settings.storage.clearAll"),
          style: "destructive",
          onPress: () => clearCache({ type: "all" }),
        },
      ],
    );
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
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
                tintColorClassName={"accent-danger-foreground"}
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
              <ActivityIndicator />
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
                tintColorClassName={"accent-icon"}
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
            <Pressable
              accessibilityRole="button"
              disabled={isClearing || !summary || summary.recordCount === 0}
              onPress={confirmClearAll}
              className="flex-row items-center gap-4 p-4 disabled:opacity-40"
            >
              <SymbolView
                name="trash"
                size={22}
                tintColorClassName={"accent-danger-foreground"}
                type="monochrome"
                weight="regular"
              />
              <Text className="flex-1 text-lg tabular-nums text-danger-foreground">
                {summary
                  ? translator.message("mobile.settings.storage.clearBytes", {
                      size: formatBytes(summary.payloadBytes),
                    })
                  : translator.message("mobile.settings.storage.clearCaches")}
              </Text>
              {isClearing ? (
                <ActivityIndicator colorClassName={"accent-danger-foreground"} />
              ) : null}
            </Pressable>
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
    </View>
  );
}

function CacheEnvironmentRow(props: {
  readonly environment: EnvironmentClientCacheSummary;
  readonly environmentLabel: string;
  readonly disabled: boolean;
  readonly first: boolean;
  readonly onClear: () => void;
}) {
  const translator = useMobileInterfaceTranslator();
  return (
    <View
      className={
        props.first
          ? "flex-row items-center gap-3 p-4"
          : "border-t border-border flex-row items-center gap-3 p-4"
      }
    >
      <SymbolView
        name="desktopcomputer"
        size={22}
        tintColorClassName={"accent-icon"}
        type="monochrome"
        weight="regular"
      />
      <Text className="min-w-0 flex-1 text-base text-foreground" numberOfLines={1}>
        {props.environmentLabel}
      </Text>
      <Pressable
        accessibilityLabel={translator.message(
          "mobile.settings.storage.clearEnvironmentAccessibility",
          { environment: props.environmentLabel },
        )}
        accessibilityRole="button"
        disabled={props.disabled}
        onPress={props.onClear}
        className="rounded-full px-3 py-2 disabled:opacity-40"
      >
        <Text className="font-t3-medium tabular-nums text-danger-foreground" numberOfLines={1}>
          {translator.message("mobile.settings.storage.clearBytes", {
            size: formatBytes(props.environment.payloadBytes),
          })}
        </Text>
      </Pressable>
    </View>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
