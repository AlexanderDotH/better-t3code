import {
  type EnvironmentConnectionPhase,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { SymbolView } from "../../components/AppSymbol";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import { useThemeColor } from "../../lib/useThemeColor";
import {
  connectionNoticeDetail,
  connectionNoticeSupportsRetryNow,
  type ConnectionNoticePresentation,
} from "./environmentRecoveryPresentation";

type EnvironmentConnectionNoticePresentation = ConnectionNoticePresentation &
  Pick<EnvironmentConnectionPresentation, "traceId">;

function noticeTitle(phase: EnvironmentConnectionPhase, environmentLabel: string): string {
  switch (phase) {
    case "offline":
      return "You are offline";
    case "connecting":
      return `Connecting to ${environmentLabel}...`;
    case "reconnecting":
      return `Reconnecting to ${environmentLabel}...`;
    case "error":
      return `${environmentLabel} is unavailable`;
    case "available":
      return `${environmentLabel} is disconnected`;
    case "connected":
      return "";
  }
}

export function EnvironmentConnectionNotice(props: {
  readonly environmentLabel: string;
  readonly connection: EnvironmentConnectionNoticePresentation;
  readonly resourceName: string;
  readonly onRetry: () => void;
}) {
  const iconColor = String(useThemeColor("--color-icon-muted"));
  const isRetrying =
    props.connection.phase === "connecting" || props.connection.phase === "reconnecting";

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="max-w-[320px] items-center gap-3">
        {isRetrying ? (
          <ActivityIndicator size="small" color={iconColor} />
        ) : (
          <SymbolView
            name={props.connection.phase === "offline" ? "wifi.slash" : "bolt.horizontal.circle"}
            size={24}
            tintColor={iconColor}
            type="monochrome"
          />
        )}

        <Text className="text-center text-lg font-t3-bold text-foreground">
          {noticeTitle(props.connection.phase, props.environmentLabel)}
        </Text>
        <Text className="text-center text-sm leading-normal text-foreground-muted">
          {connectionNoticeDetail(props.connection, props.resourceName)}
          {props.connection.traceId ? (
            <>
              {" Trace ID: "}
              <Text
                accessibilityHint="Copies the trace ID"
                accessibilityLabel={`Copy trace ID ${props.connection.traceId}`}
                accessibilityRole="button"
                className="underline decoration-dotted"
                onPress={() =>
                  copyTextWithHaptic(props.connection.traceId!, {
                    target: "connection-trace-id",
                  })
                }
              >
                {props.connection.traceId}
              </Text>
            </>
          ) : null}
        </Text>

        {connectionNoticeSupportsRetryNow(props.connection) ? (
          <Pressable
            accessibilityLabel={`Retry ${props.environmentLabel}`}
            accessibilityRole="button"
            className="mt-1 rounded-full bg-subtle px-4 py-2.5 active:opacity-70"
            onPress={props.onRetry}
          >
            <Text className="text-sm font-t3-bold text-foreground">Retry now</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
