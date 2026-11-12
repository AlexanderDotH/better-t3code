import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import { useState } from "react";
import { Linking, Platform, View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import * as Dialog from "../../components/ui/Dialog";
import { MOBILE_CLIENT_PREFERENCE_DEFAULTS } from "../../persistence/mobile-preferences";
import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsRow } from "../settings/components/SettingsRow";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";
import { requestAgentNotificationPermission } from "./notificationPermissions";
import { runtime } from "../../lib/runtime";
import { refreshLocalNotifications } from "./localThreadNotifications";
import { reportAtomCommandResult, settleAsyncResult } from "@t3tools/client-runtime/state/runtime";
import { supportsAndroidBackgroundConnection } from "./androidBackgroundConnection";

export function LocalNotificationSettings() {
  const translator = useMobileInterfaceTranslator();
  const preferencesResult = useAtomValue(mobilePreferencesAtom);
  const preferences = AsyncResult.getOrElse(preferencesResult, () => null);
  const save = useAtomSet(updateMobilePreferencesAtom);
  const [requestingBackgroundPermission, setRequestingBackgroundPermission] = useState(false);
  const request = async () => {
    const result = await settleAsyncResult(() =>
      runtime.runPromiseExit(requestAgentNotificationPermission),
    );
    if (result._tag === "Failure") {
      reportAtomCommandResult(result, { label: "local notification permission" });
      Dialog.alert(
        translator.message("mobile.settings.notifications.unavailable"),
        translator.message("mobile.ui.couldNotRequestNotificationPermission"),
      );
      return false;
    }
    if (result.value.type === "denied") await Linking.openSettings();
    if (result.value.type === "granted") refreshLocalNotifications();
    return result.value.type === "granted";
  };
  const changeBackgroundConnection = async (enabled: boolean) => {
    if (!enabled) {
      save({ androidBackgroundConnectionEnabled: false });
      return;
    }
    setRequestingBackgroundPermission(true);
    const granted = await request().finally(() => {
      setRequestingBackgroundPermission(false);
    });
    if (granted) save({ androidBackgroundConnectionEnabled: true });
  };
  return (
    <SettingsSection title={translator.message("mobile.insights.notifications.localTitle")}>
      <SettingsSwitchRow
        icon="bell.badge"
        label={translator.message("mobile.insights.notifications.inApp")}
        value={
          preferences?.inAppNotificationsEnabled ??
          MOBILE_CLIENT_PREFERENCE_DEFAULTS.inAppNotificationsEnabled
        }
        onValueChange={(inAppNotificationsEnabled) => save({ inAppNotificationsEnabled })}
      />
      {Platform.OS === "android" ? (
        <SettingsSwitchRow
          icon="bolt.circle"
          label={translator.message("mobile.insights.notifications.backgroundConnection")}
          subtitle={translator.message("mobile.insights.notifications.backgroundConnectionHelp")}
          disabled={
            !AsyncResult.isSuccess(preferencesResult) ||
            !supportsAndroidBackgroundConnection() ||
            requestingBackgroundPermission
          }
          value={
            preferences?.androidBackgroundConnectionEnabled ??
            MOBILE_CLIENT_PREFERENCE_DEFAULTS.androidBackgroundConnectionEnabled
          }
          onValueChange={(enabled) => {
            void changeBackgroundConnection(enabled).catch((error: unknown) =>
              console.warn("[notifications] background connection permission failed", error),
            );
          }}
        />
      ) : null}
      <SettingsRow
        icon="bell.badge"
        label={translator.message("mobile.settings.deviceNotifications")}
        onPress={() => {
          void request().catch((error: unknown) =>
            console.warn("[notifications] permission request failed", error),
          );
        }}
      />
      <SettingsRow
        icon="gearshape"
        label={translator.message("mobile.insights.notifications.system")}
        onPress={() => void Linking.openSettings()}
      />
      <View className="p-4">
        <AppText className="text-sm text-foreground-muted">
          {translator.message("mobile.insights.notifications.localHelp")}
        </AppText>
      </View>
    </SettingsSection>
  );
}
