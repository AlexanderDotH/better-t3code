import { View } from "react-native";

import { ListChoiceRow as SettingsChoiceRow } from "../../../../components/ui/ListChoiceRow";
import { SettingsSection } from "../../components/SettingsSection";
import { useAppearancePreferences } from "../AppearancePreferencesProvider";
import { useMobileInterfaceTranslator } from "../../../../localization/useMobileInterfaceTranslator";

export function AndroidNavigationAppearanceSection() {
  const translator = useMobileInterfaceTranslator();
  const { isReady, androidNavigationStyle, setAndroidNavigationStyle } = useAppearancePreferences();
  return (
    <SettingsSection title={translator.message("browser.chrome.navigation")}>
      <View accessibilityRole="radiogroup">
        <SettingsChoiceRow
          label={translator.message("mobile.ui.oneUi")}
          description={translator.message("mobile.ui.floatingNavigationWithASeparateComposeButton")}
          disabled={!isReady}
          selected={androidNavigationStyle === "one-ui"}
          onPress={() => setAndroidNavigationStyle("one-ui")}
        />
        <SettingsChoiceRow
          label={translator.message("mobile.ui.material")}
          description={translator.message("mobile.ui.standardAndroidNavigationBarAndSideRail")}
          disabled={!isReady}
          selected={androidNavigationStyle === "material"}
          onPress={() => setAndroidNavigationStyle("material")}
          separated
        />
      </View>
    </SettingsSection>
  );
}
