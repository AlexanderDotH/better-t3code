import { requireOptionalNativeModule } from "expo";
import { AppRegistry, DeviceEventEmitter, Platform } from "react-native";

interface AndroidBackgroundConnection {
  setConnection(enabled: boolean, title: string, body: string, channelName: string): boolean;
}

const native =
  Platform.OS === "android"
    ? requireOptionalNativeModule<AndroidBackgroundConnection>("T3BackgroundConnection")
    : null;

if (Platform.OS === "android") {
  // The native service ends this task to let React Native pause timers again.
  AppRegistry.registerHeadlessTask(
    "T3BackgroundConnection",
    () =>
      ({ sessionId }: { readonly sessionId: string }) =>
        new Promise<void>((resolve) => {
          const subscription = DeviceEventEmitter.addListener(
            "T3BackgroundConnectionStopped",
            (stoppedSessionId: string) => {
              if (stoppedSessionId !== sessionId) return;
              subscription.remove();
              resolve();
            },
          );
        }),
  );
}

export function supportsAndroidBackgroundConnection(): boolean {
  return typeof native?.setConnection === "function";
}

export function setAndroidBackgroundConnection(
  notification: {
    readonly title: string;
    readonly body: string;
    readonly channelName: string;
  } | null,
): boolean {
  return (
    native?.setConnection(
      notification !== null,
      notification?.title ?? "",
      notification?.body ?? "",
      notification?.channelName ?? "",
    ) ?? false
  );
}
