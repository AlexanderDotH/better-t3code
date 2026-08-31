import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { CodeAppearanceSection } from "./appearance/sections/CodeAppearanceSection";
import { ChatVisualsAppearanceSection } from "./appearance/sections/ChatVisualsAppearanceSection";
import { ProjectThreadPreviewCountSection } from "./appearance/sections/ProjectThreadPreviewCountSection";
import { TerminalAppearanceSection } from "./appearance/sections/TerminalAppearanceSection";
import { TextAppearanceSection } from "./appearance/sections/TextAppearanceSection";
import { ThreadListAppearanceSection } from "./appearance/sections/ThreadListAppearanceSection";
import { ThemeAppearanceSection } from "./appearance/sections/ThemeAppearanceSection";
import { InterfaceLanguageSection } from "./appearance/sections/InterfaceLanguageSection";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function SettingsAppearanceRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  return (
    <AndroidScreenScaffold title={translator.message("mobile.appearance.title")}>
      <ScreenScaffoldScrollView>
        <ThemeAppearanceSection />
        <InterfaceLanguageSection />
        <ThreadListAppearanceSection />
        <ProjectThreadPreviewCountSection />
        <ChatVisualsAppearanceSection />
        <TextAppearanceSection />
        <TerminalAppearanceSection />
        <CodeAppearanceSection />
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}
