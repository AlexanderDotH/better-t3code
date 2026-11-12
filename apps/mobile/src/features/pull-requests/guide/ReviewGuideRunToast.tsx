import { useAtomValue } from "@effect/atom-react";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Toast } from "../../../components/ui/Toast";
import { useMobileInterfaceTranslator } from "../../../localization/useMobileInterfaceTranslator";
import {
  dismissGuideRunNotice,
  guideRunNoticesAtom,
  openGuideRunNotice,
} from "./reviewGuideRunNotifications";

export function ReviewGuideRunToast() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const notice = useAtomValue(guideRunNoticesAtom)[0];
  if (!notice) return null;
  return (
    <View
      pointerEvents="box-none"
      className="absolute left-3 right-3 z-50"
      style={{ top: insets.top + 8 }}
    >
      <Toast
        message={notice.title}
        description={notice.body}
        tone={notice.failed ? "danger" : "success"}
        onDismiss={dismissGuideRunNotice}
        action={{
          label: translator.message("mobile.pulls.guide.open"),
          onPress: () => {
            dismissGuideRunNotice();
            openGuideRunNotice(notice.target);
          },
        }}
      />
    </View>
  );
}
