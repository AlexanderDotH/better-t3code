import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ScreenScrollView } from "../../components/ui/ScreenScrollView";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { SettingsScreen } from "./components/SettingsScreen";
import { MobileClientPreferenceRows } from "./MobileClientPreferenceRows";
import { SettingsSection } from "./components/SettingsSection";
import { CodeAppearancePreview } from "./appearance/components/AppearancePreviews";
import { useAppearancePreferences } from "./appearance/AppearancePreferencesProvider";

export function SettingsDiffsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const insets = useSafeAreaInsets();
  const { appearance } = useAppearancePreferences();
  return (
    <SettingsScreen title={translator.message("mobile.prefs.diffs")}>
      <ScreenScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerClassName="gap-3 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <MobileClientPreferenceRows group="diffs" />
        <SettingsSection title={translator.message("mobile.prefs.preview")}>
          <CodeAppearancePreview
            fontSize={appearance.codeFontSize}
            wordBreak={appearance.codeWordBreak}
          />
        </SettingsSection>
      </ScreenScrollView>
    </SettingsScreen>
  );
}
