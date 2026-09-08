import {
  type EnvironmentConnectionPhase,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { SymbolView } from "../../components/AppSymbol";
import { ActivityIndicator, Pressable, View } from "react-native";

import { AppText as Text } from "../../components/AppText";
import { copyTextWithHaptic } from "../../lib/copyTextWithHaptic";
import {
  connectionNoticeDetail,
  connectionNoticeSupportsRetryNow,
  type ConnectionNoticePresentation,
} from "./environmentRecoveryPresentation";
import { type InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

type EnvironmentConnectionNoticePresentation = ConnectionNoticePresentation &
  Pick<EnvironmentConnectionPresentation, "traceId">;

function noticeTitle(
  phase: EnvironmentConnectionPhase,
  environmentLabel: string,
  translator: InterfaceTranslator,
): string {
  switch (phase) {
    case "offline":
      return translator.message("mobile.connection.offlineTitle");
    case "connecting":
      return translator.message("mobile.connection.connectingTitle", {
        environment: environmentLabel,
      });
    case "reconnecting":
      return translator.message("mobile.connection.reconnectingTitle", {
        environment: environmentLabel,
      });
    case "error":
      return translator.message("mobile.connection.unavailableTitle", {
        environment: environmentLabel,
      });
    case "available":
      return translator.message("mobile.connection.disconnectedTitle", {
        environment: environmentLabel,
      });
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
  const translator = useMobileInterfaceTranslator();
  const isRetrying =
    props.connection.phase === "connecting" || props.connection.phase === "reconnecting";

  return (
    <View className="flex-1 items-center justify-center px-8">
      <View className="max-w-[320px] items-center gap-3">
        {isRetrying ? (
          <ActivityIndicator size="small" colorClassName={"accent-icon-muted"} />
        ) : (
          <SymbolView
            name={props.connection.phase === "offline" ? "wifi.slash" : "bolt.horizontal.circle"}
            size={24}
            tintColorClassName={"accent-icon-muted"}
            type="monochrome"
          />
        )}

        <Text className="text-center text-lg font-t3-bold text-foreground">
          {noticeTitle(props.connection.phase, props.environmentLabel, translator)}
        </Text>
        <Text className="text-center text-sm leading-normal text-foreground-muted">
          {connectionNoticeDetail(props.connection, props.resourceName)}
          {props.connection.traceId ? (
            <>
              {translator.message("mobile.connection.traceId")}
              <Text
                accessibilityHint={translator.message("mobile.connection.copyTraceHint")}
                accessibilityLabel={translator.message("mobile.connection.copyTraceWithId", {
                  traceId: props.connection.traceId,
                })}
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
            accessibilityLabel={translator.message("mobile.connection.retryEnvironment", {
              environment: props.environmentLabel,
            })}
            accessibilityRole="button"
            className="mt-1 rounded-full bg-subtle px-4 py-2.5 active:opacity-70"
            onPress={props.onRetry}
          >
            <Text className="text-sm font-t3-bold text-foreground">
              {translator.message("mobile.connection.retryNow")}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
