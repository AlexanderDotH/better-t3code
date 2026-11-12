import * as Notifications from "expo-notifications";
import { AppState } from "react-native";

import { setAndroidThreadOnScreen } from "./androidNotifications";
import { installAndroidBackgroundConnection } from "./backgroundConnection";
import { foregroundNotificationBehavior } from "./foregroundNotificationBehavior";
import {
  extractAgentNotificationDeepLink,
  routeAgentNotificationResponseOnce,
  threadDeepLinkOnScreen,
} from "./notificationPayload";
import { consumeLastAgentNotificationResponse } from "./notificationResponseConsumer";
import {
  installLocalThreadNotifications,
  locallyObservesNotificationPath,
  setLocalNotificationPath,
} from "./localThreadNotifications";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";
import { appAtomRegistry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { AsyncResult } from "effect/reactivity";

let deepLinkOnScreen: string | null = null;

/** Called with the workspace pathname on every root navigation state change. */
export function setAgentNotificationPathname(pathname: string): void {
  deepLinkOnScreen = threadDeepLinkOnScreen(pathname);
  setLocalNotificationPath(deepLinkOnScreen);
  setAndroidThreadOnScreen(deepLinkOnScreen);
}

/**
 * App-lifetime notification routing: foreground presentation suppresses the
 * thread already on screen, and taps (including the cold-start tap) open the
 * notification's deep link through `navigate`.
 */
export function installAgentNotificationNavigation(navigate: (href: string) => void): () => void {
  const stopLocalNotifications = installLocalThreadNotifications(navigate);
  const stopBackgroundConnection = installAndroidBackgroundConnection();
  const handledResponseIds = new Set<string>();
  Notifications.setNotificationHandler({
    handleNotification: (notification) => {
      if (AppState.currentState !== "active")
        return Promise.resolve(foregroundNotificationBehavior(notification, null));
      const preferences = AsyncResult.getOrElse(
        appAtomRegistry.get(mobilePreferencesAtom),
        () => null,
      );
      const locallyObserved = locallyObservesNotificationPath(
        extractAgentNotificationDeepLink({ notification }),
      );
      return Promise.resolve(
        foregroundNotificationBehavior(
          notification,
          deepLinkOnScreen,
          !locallyObserved &&
            (preferences?.inAppNotificationsEnabled ??
              MOBILE_CLIENT_PREFERENCE_DEFAULTS.inAppNotificationsEnabled),
        ),
      );
    },
  });

  const handleResponse = (response: Notifications.NotificationResponse): void => {
    routeAgentNotificationResponseOnce({ handledResponseIds, response, navigate });
  };
  const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);
  void consumeLastAgentNotificationResponse({
    getLastResponse: () => Notifications.getLastNotificationResponseAsync(),
    clearLastResponse: () => Notifications.clearLastNotificationResponseAsync(),
    handleResponse,
  });

  return () => {
    stopBackgroundConnection();
    stopLocalNotifications();
    subscription.remove();
    Notifications.setNotificationHandler(null);
  };
}
