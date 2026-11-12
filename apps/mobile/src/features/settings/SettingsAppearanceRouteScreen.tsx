import { Platform } from "react-native";
import { AndroidNavigationAppearanceSection } from "./appearance/sections/AndroidNavigationAppearanceSection";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SettingsScreen } from "./components/SettingsScreen";
import { CodeAppearanceSection } from "./appearance/sections/CodeAppearanceSection";
import { ChatVisualsAppearanceSection } from "./appearance/sections/ChatVisualsAppearanceSection";
import { ProjectThreadPreviewCountSection } from "./appearance/sections/ProjectThreadPreviewCountSection";
import { TerminalAppearanceSection } from "./appearance/sections/TerminalAppearanceSection";
import { TextAppearanceSection } from "./appearance/sections/TextAppearanceSection";
import { ThreadListAppearanceSection } from "./appearance/sections/ThreadListAppearanceSection";
import { ThemeAppearanceSection } from "./appearance/sections/ThemeAppearanceSection";
import { InterfaceLanguageSection } from "./appearance/sections/InterfaceLanguageSection";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { InterfaceAppearanceSection } from "./appearance/sections/InterfaceAppearanceSection";

export function SettingsAppearanceRouteScreen() {
  const insets = useSafeAreaInsets();
  const translator = useMobileInterfaceTranslator();
  return (
    <SettingsScreen title={translator.message("mobile.appearance.title")}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerClassName="gap-6 px-5 pt-4"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 18) + 18 }}
      >
        <ThemeAppearanceSection />
        {Platform.OS === "android" ? <AndroidNavigationAppearanceSection /> : null}
        <InterfaceLanguageSection />
        <InterfaceAppearanceSection />
        <ThreadListAppearanceSection />
        <ProjectThreadPreviewCountSection />
        <ChatVisualsAppearanceSection />
        <TextAppearanceSection />
        <TerminalAppearanceSection />
        <CodeAppearanceSection />
      </ScrollView>
    </SettingsScreen>
  );
}
