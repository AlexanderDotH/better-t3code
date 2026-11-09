import { Platform } from "react-native";

import { AndroidHeaderIconButton } from "../../components/ui/AndroidScreenHeader";

import { useAdaptiveWorkspaceLayout } from "./adaptive-workspace-context";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function AndroidWorkspaceSidebarButton() {
  const translator = useMobileInterfaceTranslator();
  const { layout, panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  if (Platform.OS !== "android" || !layout.usesSplitView) return null;

  return (
    <AndroidHeaderIconButton
      accessibilityLabel={
        panes.primarySidebarVisible
          ? translator.message("mobile.thread.maximizeContent")
          : translator.message("mobile.ui.showSidebar")
      }
      icon={panes.primarySidebarVisible ? "arrow.up.left.and.arrow.down.right" : "sidebar.left"}
      onPress={togglePrimarySidebar}
    />
  );
}
