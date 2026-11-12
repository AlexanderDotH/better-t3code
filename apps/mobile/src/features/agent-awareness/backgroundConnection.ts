import { AsyncResult } from "effect/reactivity";
import { AppState, Platform } from "react-native";

import { environmentCatalog } from "../../connection/catalog";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";
import { appAtomRegistry as registry } from "../../state/atom-registry";
import { mobilePreferencesAtom } from "../../state/preferences";
import { environmentPresentations } from "../../state/presentation";
import {
  setAndroidBackgroundConnection,
  supportsAndroidBackgroundConnection,
} from "./androidBackgroundConnection";
import {
  backgroundConnectionNotification,
  backgroundConnectionShouldRun,
} from "./background-connection";

export function installAndroidBackgroundConnection(): () => void {
  if (Platform.OS !== "android" || !supportsAndroidBackgroundConnection()) return () => {};

  let running = false;
  let lastNotification: string | null | undefined;
  const sync = (force = false) => {
    const preferences = registry.get(mobilePreferencesAtom);
    const catalog = registry.get(environmentCatalog.catalogValueAtom);
    if (!AsyncResult.isSuccess(preferences) || !catalog.isReady) return;

    let configuredEnvironmentCount = 0;
    let connectedEnvironmentCount = 0;
    for (const presentation of registry.get(environmentPresentations.presentationsAtom).values()) {
      if (!presentation.entry.enabled || presentation.entry.unsupportedReason !== undefined)
        continue;
      configuredEnvironmentCount++;
      if (presentation.connection.phase === "connected") connectedEnvironmentCount++;
    }
    const shouldRun = backgroundConnectionShouldRun({
      platform: Platform.OS,
      enabled:
        preferences.value.androidBackgroundConnectionEnabled ??
        MOBILE_CLIENT_PREFERENCE_DEFAULTS.androidBackgroundConnectionEnabled,
      configuredEnvironmentCount,
      connectedEnvironmentCount,
      running,
    });
    const notification = shouldRun
      ? backgroundConnectionNotification(connectedEnvironmentCount, currentInterfaceTranslator())
      : null;
    const key = notification === null ? null : JSON.stringify(notification);
    if (!force && key === lastNotification) return;

    try {
      running = setAndroidBackgroundConnection(notification);
      lastNotification = shouldRun && !running ? undefined : key;
    } catch (error) {
      running = false;
      lastNotification = undefined;
      console.warn("[notifications] background connection update failed", error);
    }
  };
  const stopPreferences = registry.subscribe(mobilePreferencesAtom, () => sync(), {
    immediate: true,
  });
  const stopEnvironments = registry.subscribe(
    environmentPresentations.presentationsAtom,
    () => sync(),
    {
      immediate: true,
    },
  );
  const appState = AppState.addEventListener("change", (state) => {
    if (state === "active") sync(true);
  });

  return () => {
    stopPreferences();
    stopEnvironments();
    appState.remove();
    try {
      setAndroidBackgroundConnection(null);
    } catch (error) {
      console.warn("[notifications] background connection cleanup failed", error);
    }
  };
}
