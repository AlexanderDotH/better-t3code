import { MenuView } from "@react-native-menu/menu";
import { Platform, View } from "react-native";
import type { visualizationLabels } from "@t3tools/client-runtime/visualizations/labels";

import { SymbolView } from "../../components/AppSymbol";
import { ControlPillMenu } from "../../components/ControlPillMenu";

export function VisualizationActionsMenu({
  labels,
  sourceVisible,
  sourceRequired = false,
  exportReady,
  copied,
  inModal = false,
  onToggleSource,
  onCopySource,
  onExportSvg,
  onExportPng,
}: {
  labels: ReturnType<typeof visualizationLabels>;
  sourceVisible: boolean;
  sourceRequired?: boolean;
  exportReady: boolean;
  copied: boolean;
  inModal?: boolean;
  onToggleSource: () => void;
  onCopySource: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
}) {
  // Android's regular menu portal sits behind native fullscreen modals.
  const Menu = inModal && Platform.OS === "android" ? MenuView : ControlPillMenu;
  return (
    <Menu
      title={labels.actions}
      isAnchoredToRight
      actions={[
        {
          id: "source",
          title: sourceVisible ? labels.hideSource : labels.showSource,
          attributes: { disabled: sourceRequired },
        },
        { id: "copy", title: copied ? labels.copied : labels.copySource },
        { id: "svg", title: labels.exportSvg, attributes: { disabled: !exportReady } },
        { id: "png", title: labels.exportPng, attributes: { disabled: !exportReady } },
      ]}
      onPressAction={({ nativeEvent }) => {
        if (nativeEvent.event === "source" && !sourceRequired) onToggleSource();
        if (nativeEvent.event === "copy") onCopySource();
        if (nativeEvent.event === "svg" && exportReady) onExportSvg();
        if (nativeEvent.event === "png" && exportReady) onExportPng();
      }}
    >
      <View
        accessible
        accessibilityRole="button"
        accessibilityLabel={labels.actions}
        className="min-h-11 min-w-11 items-center justify-center rounded-full"
      >
        <SymbolView
          name={{ ios: "ellipsis", android: "more_vert" }}
          size={20}
          tintColorClassName="accent-icon-muted"
          type="monochrome"
        />
      </View>
    </Menu>
  );
}
