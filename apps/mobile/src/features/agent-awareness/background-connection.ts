import type { InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

export function backgroundConnectionShouldRun(input: {
  readonly platform: string;
  readonly enabled: boolean;
  readonly configuredEnvironmentCount: number;
  readonly connectedEnvironmentCount: number;
  readonly running: boolean;
}): boolean {
  return (
    input.platform === "android" &&
    input.enabled &&
    input.configuredEnvironmentCount > 0 &&
    (input.connectedEnvironmentCount > 0 || input.running)
  );
}

export function backgroundConnectionNotification(
  connectedEnvironmentCount: number,
  translator: InterfaceTranslator,
) {
  return {
    title: "Better T3 Code",
    body: translator.message(
      connectedEnvironmentCount === 0
        ? "mobile.insights.notifications.backgroundReconnecting"
        : connectedEnvironmentCount === 1
          ? "mobile.insights.notifications.backgroundConnectedOne"
          : "mobile.insights.notifications.backgroundConnectedMany",
      { count: connectedEnvironmentCount },
    ),
    channelName: translator.message("mobile.insights.notifications.backgroundConnection"),
  };
}
