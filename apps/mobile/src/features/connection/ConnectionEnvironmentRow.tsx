import { SymbolView } from "../../components/AppSymbol";
import { connectionStatusText } from "@t3tools/client-runtime/connection";
import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/unstable/reactivity";
import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";

import { AppText as Text, AppTextInput as TextInput } from "../../components/AppText";
import { cn } from "../../lib/cn";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import { ConnectionStatusDot } from "./ConnectionStatusDot";
import {
  environmentLastSyncedText,
  environmentRecoveryAction,
  type EnvironmentRecoveryAction,
} from "./environmentSections";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

function connectionStatusLabel(environment: ConnectedEnvironmentSummary): string | null {
  return connectionStatusText({
    phase: environment.connectionState,
    error: environment.connectionError,
  });
}

function recoveryAction(
  environment: ConnectedEnvironmentSummary,
): EnvironmentRecoveryAction | null {
  const connection = environment.connection;
  return environmentRecoveryAction({
    phase: environment.connectionState,
    isRelayManaged: environment.isRelayManaged,
    retry:
      connection?.retry ??
      (environment.connectionState === "available" || environment.connectionState === "error"
        ? { mode: "manual", at: null }
        : { mode: "none", at: null }),
    failureReason: connection?.failure?.reason ?? null,
  });
}

export function ConnectionEnvironmentRow(props: {
  readonly environment: ConnectedEnvironmentSummary;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onReconnect: (environmentId: EnvironmentId) => void;
  readonly onRemove: (environmentId: EnvironmentId) => void;
  readonly onPairAgain: (environmentId: EnvironmentId) => void;
  readonly onSignIn: () => void;
  readonly onUpdate: (
    environmentId: EnvironmentId,
    updates: { readonly label: string; readonly displayUrl: string },
  ) => Promise<AtomCommandResult<unknown, unknown>>;
}) {
  const translator = useMobileInterfaceTranslator();
  const [label, setLabel] = useState(props.environment.environmentLabel);
  const [url, setUrl] = useState(props.environment.displayUrl);
  const statusLabel = connectionStatusLabel(props.environment);
  const statusTraceId =
    props.environment.connection?.failure?.traceId ?? props.environment.connectionErrorTraceId;
  const hasConnectionFailure = props.environment.connectionError !== null;
  const isRetrying =
    props.environment.connectionState === "connecting" ||
    props.environment.connectionState === "reconnecting";
  const lastSyncedText = environmentLastSyncedText({
    phase: props.environment.connectionState,
    updatedAt: props.environment.cacheUpdatedAt ?? null,
  });
  const primaryRecoveryAction = recoveryAction(props.environment);
  const handleRecovery = useCallback(() => {
    switch (primaryRecoveryAction?.kind) {
      case "edit":
        if (!props.expanded) props.onToggle();
        return;
      case "pair":
        props.onPairAgain(props.environment.environmentId);
        return;
      case "sign-in":
        props.onSignIn();
        return;
      case "retry":
        props.onReconnect(props.environment.environmentId);
        return;
      case undefined:
        return;
    }
  }, [primaryRecoveryAction, props]);
  const handleSave = useCallback(async () => {
    const result = await props.onUpdate(props.environment.environmentId, {
      label: label.trim(),
      displayUrl: url.trim(),
    });
    if (AsyncResult.isSuccess(result)) {
      props.onToggle();
      return;
    }
    const error = Cause.squash(result.cause);
    Alert.alert(
      translator.message("mobile.connection.updateFailed"),
      error instanceof Error
        ? error.message
        : translator.message("mobile.connection.updateFailedDescription"),
    );
  }, [label, props, translator, url]);

  return (
    <Animated.View layout={LinearTransition.duration(250)} className="bg-card">
      <Pressable
        accessibilityLabel={translator.message("mobile.connection.manage", {
          environment: props.environment.environmentLabel,
        })}
        accessibilityRole="button"
        accessibilityState={{ expanded: props.expanded }}
        className="flex-row items-center gap-3 px-4 py-3.5 active:opacity-70"
        onPress={props.onToggle}
      >
        <ConnectionStatusDot
          state={props.environment.connectionState}
          pulse={isRetrying}
          size={8}
        />

        <View className="flex-1 gap-0.5">
          <Text className="text-base font-t3-bold leading-snug text-foreground" numberOfLines={1}>
            {props.environment.environmentLabel}
          </Text>
          <Text className="text-xs text-foreground-muted" numberOfLines={1}>
            {props.environment.isRelayManaged
              ? translator.message("mobile.connection.connectSaved")
              : props.environment.displayUrl}
          </Text>
          {statusLabel ? (
            <Text
              className={cn(
                "text-xs",
                hasConnectionFailure ? "text-adaptive-rose-500-400" : "text-foreground-muted",
              )}
              numberOfLines={props.expanded ? undefined : 1}
              selectable={props.expanded}
            >
              {statusLabel}
              {statusTraceId ? (
                <>
                  {translator.message("mobile.connection.traceId")}
                  <Text
                    accessibilityHint={translator.message("mobile.connection.copyTraceHint")}
                    accessibilityLabel={translator.message("mobile.connection.copyTraceWithId", {
                      traceId: statusTraceId,
                    })}
                    accessibilityRole="button"
                    className="underline decoration-dotted"
                    onPress={(event) => {
                      event.stopPropagation();
                      copyTextWithHaptic(statusTraceId, { target: "connection-trace-id" });
                    }}
                  >
                    {statusTraceId}
                  </Text>
                </>
              ) : null}
            </Text>
          ) : null}
          {lastSyncedText ? (
            <Text className="text-xs text-foreground-muted" numberOfLines={1}>
              {lastSyncedText}
            </Text>
          ) : null}
        </View>

        <View className="flex-row items-center gap-2">
          {primaryRecoveryAction ? (
            <Pressable
              accessibilityLabel={`${primaryRecoveryAction.label} for ${props.environment.environmentLabel}`}
              accessibilityRole="button"
              className="rounded-full bg-subtle px-3 py-2 active:opacity-70"
              onPress={(event) => {
                event.stopPropagation();
                handleRecovery();
              }}
            >
              <Text className="text-xs font-t3-bold text-foreground">
                {primaryRecoveryAction.label}
              </Text>
            </Pressable>
          ) : null}
          <SymbolView
            name="chevron.down"
            size={12}
            tintColorClassName={"accent-icon-subtle"}
            type="monochrome"
            style={{
              transform: [{ rotate: props.expanded ? "180deg" : "0deg" }],
            }}
          />
        </View>
      </Pressable>

      {props.expanded ? (
        <Animated.View
          entering={FadeIn.duration(200)}
          exiting={FadeOut.duration(150)}
          className="gap-3 px-4 pb-4"
        >
          {props.environment.isRelayManaged ? (
            <Text className="text-sm text-foreground-muted">
              {translator.message("mobile.connection.managedDescription")}
            </Text>
          ) : (
            <>
              <View className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  {translator.message("mobile.connection.label")}
                </Text>
                <TextInput
                  accessibilityLabel={translator.message("mobile.connection.environmentLabel")}
                  autoCapitalize="words"
                  autoCorrect={false}
                  placeholder={translator.message("mobile.connection.labelPlaceholder")}
                  value={label}
                  onChangeText={setLabel}
                  className="rounded-[14px] border border-input-border bg-input px-4 py-3 text-base text-foreground"
                />
              </View>

              <View className="gap-1.5">
                <Text className="text-2xs font-t3-bold tracking-[0.8px] uppercase text-foreground-muted">
                  {translator.message("mobile.connection.url")}
                </Text>
                <TextInput
                  accessibilityLabel={translator.message("mobile.connection.environmentUrl")}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                  placeholder="192.168.1.100:8080"
                  value={url}
                  onChangeText={setUrl}
                  className="rounded-[14px] border border-input-border bg-input px-4 py-3 text-base text-foreground"
                />
              </View>
            </>
          )}

          <View className="flex-row justify-end gap-2">
            {props.environment.isRelayManaged ? null : (
              <Pressable
                accessibilityLabel={translator.message("mobile.connection.saveChanges", {
                  environment: props.environment.environmentLabel,
                })}
                accessibilityRole="button"
                className="min-h-[42px] flex-1 flex-row items-center justify-center gap-1.5 rounded-[14px] bg-primary px-3.5 py-2.5 active:opacity-70"
                onPress={handleSave}
              >
                <SymbolView
                  name="checkmark"
                  size={13}
                  tintColorClassName={"accent-primary-foreground"}
                  type="monochrome"
                />
                <Text className="text-xs font-t3-bold tracking-[0.8px] uppercase text-primary-foreground">
                  {translator.message("mobile.connection.save")}
                </Text>
              </Pressable>
            )}

            <Pressable
              accessibilityHint={translator.message("mobile.connection.connectNowHint")}
              accessibilityLabel={translator.message("mobile.connection.retryEnvironment", {
                environment: props.environment.environmentLabel,
              })}
              accessibilityRole="button"
              className="h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-input-border bg-input active:opacity-70"
              onPress={() => props.onReconnect(props.environment.environmentId)}
            >
              <SymbolView
                name="arrow.clockwise"
                size={14}
                tintColorClassName={"accent-icon-subtle"}
                type="monochrome"
              />
            </Pressable>

            <Pressable
              accessibilityHint={translator.message("mobile.connection.removeHint")}
              accessibilityLabel={translator.message("mobile.connection.forgetEnvironment", {
                environment: props.environment.environmentLabel,
              })}
              accessibilityRole="button"
              className="h-[42px] w-[42px] items-center justify-center rounded-[14px] border border-danger-border bg-danger active:opacity-70"
              onPress={() => props.onRemove(props.environment.environmentId)}
            >
              <SymbolView
                name="trash"
                size={14}
                tintColorClassName={"accent-danger-foreground"}
                type="monochrome"
              />
            </Pressable>
          </View>
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}
