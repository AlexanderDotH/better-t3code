import { useSyncExternalStore } from "react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Toast } from "../../components/ui/Toast";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import {
  dismissLocalNotification,
  getLocalNotification,
  subscribeLocalNotification,
} from "./localThreadNotifications";

export function LocalNotificationToast() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const notice = useSyncExternalStore(subscribeLocalNotification, getLocalNotification);
  if (!notice) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute right-3 left-3 z-50"
      style={{ top: insets.top + 8 }}
    >
      <Toast
        message={notice.title}
        description={notice.body}
        onDismiss={dismissLocalNotification}
        action={{
          label: translator.message("mobile.insights.notifications.openThread"),
          onPress: () => {
            dismissLocalNotification();
            notice.navigate();
          },
        }}
      />
    </View>
  );
}
