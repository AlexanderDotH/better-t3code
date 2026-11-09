import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { Button } from "../../components/ui/Button";
import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { ConnectionTraceId } from "./ConnectionTraceId";
import {
  type EnvironmentConnectionPhase,
  type EnvironmentConnectionPresentation,
} from "@t3tools/client-runtime/connection";
import { SymbolView } from "../../components/ui/AppSymbol";
import { View } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import {
  connectionNoticeDetail,
  connectionNoticeSupportsRetryNow,
  type ConnectionNoticePresentation,
} from "./environmentRecoveryPresentation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

function noticeTitle(
  phase: EnvironmentConnectionPhase,
  environmentLabel: string,
  translator: InterfaceTranslator,
): string {
  const environment = environmentLabel;
  switch (phase) {
    case "offline":
      return translator.message("mobile.connection.offlineTitle");
    case "connecting":
      return translator.message("mobile.connection.connectingTitle", { environment });
    case "reconnecting":
      return translator.message("mobile.connection.reconnectingTitle", { environment });
    case "unsupported":
      return translator.message("cloud.connection.unsupported");
    case "error":
      return translator.message("mobile.connection.unavailableTitle", { environment });
    case "available":
      return translator.message("mobile.connection.disconnectedTitle", { environment });
    case "connected":
      return "";
  }
}

export function EnvironmentConnectionNotice(props: {
  readonly environmentLabel: string;
  readonly connection: ConnectionNoticePresentation &
    Pick<EnvironmentConnectionPresentation, "traceId">;
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
          <AppActivityIndicator size="small" colorClassName={"accent-icon-muted"} />
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
            <ConnectionTraceId traceId={props.connection.traceId} />
          ) : null}
        </Text>

        {connectionNoticeSupportsRetryNow(props.connection) ? (
          <View className="mt-1">
            <Button
              label={translator.message("mobile.connection.retryNow")}
              tone="secondary"
              onPress={props.onRetry}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}
