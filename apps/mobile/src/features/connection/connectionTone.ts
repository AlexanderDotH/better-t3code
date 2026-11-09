import type { StatusTone } from "../../components/StatusPill";
import type { RemoteClientConnectionState } from "../../lib/connection";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export function connectionTone(state: RemoteClientConnectionState): StatusTone {
  switch (state) {
    case "connected":
      return {
        label: currentInterfaceTranslator().message("chat.environment.status.connected"),
        pillClassName: "bg-adaptive-emerald-500-a12-a16",
        textClassName: "text-adaptive-emerald-700-300",
      };
    case "reconnecting":
      return {
        label: currentInterfaceTranslator().message(
          "settings.betterT3.status.lifecycleReconnecting",
        ),
        pillClassName: "bg-warning",
        textClassName: "text-warning-foreground",
      };
    case "connecting":
      return {
        label: currentInterfaceTranslator().message("mobile.thread.voiceConnecting"),
        pillClassName: "bg-update",
        textClassName: "text-update-foreground",
      };
    case "unsupported":
      return {
        label: currentInterfaceTranslator().message("chat.environment.status.unsupported"),
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-secondary",
      };
    case "error":
      return {
        label: currentInterfaceTranslator().message("chat.environment.status.failed"),
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      };
    case "offline":
      return {
        label: currentInterfaceTranslator().message("chat.environment.status.offline"),
        pillClassName: "bg-danger",
        textClassName: "text-danger-foreground",
      };
    case "available":
      return {
        label: currentInterfaceTranslator().message("settings.common.available"),
        pillClassName: "bg-subtle",
        textClassName: "text-foreground-secondary",
      };
  }
}
