import { useNativeWorkspaceColumnsSupported } from "../../native/NativeWorkspaceColumns";
import { useAdaptiveWorkspaceLayout } from "./AdaptiveWorkspaceLayout";
import { withNativeGlassHeaderItem } from "./native-glass-header-items";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

export function useWorkspaceSidebarHeaderItem() {
  const usesNativeWorkspaceColumns = useNativeWorkspaceColumnsSupported();
  const { layout, panes, togglePrimarySidebar } = useAdaptiveWorkspaceLayout();
  const label = panes.primarySidebarVisible
    ? layout.primarySidebarOverlaysContent
      ? currentInterfaceTranslator().message("mobile.ui.hideThreadSidebar")
      : currentInterfaceTranslator().message("mobile.thread.maximizeContent")
    : currentInterfaceTranslator().message("mobile.ui.showThreadSidebar");
  return withNativeGlassHeaderItem({
    axisBehavior: usesNativeWorkspaceColumns ? "horizontalOnly" : undefined,
    accessibilityLabel: label,
    icon: {
      name:
        panes.primarySidebarVisible && !layout.primarySidebarOverlaysContent
          ? "arrow.up.left.and.arrow.down.right"
          : "sidebar.left",
      type: "sfSymbol" as const,
    },
    identifier: "thread-left-sidebar",
    label,
    onPress: togglePrimarySidebar,
    type: "button" as const,
  });
}
