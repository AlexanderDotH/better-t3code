import { useNavigation } from "@react-navigation/native";
import { View } from "react-native";
import { EmptyState } from "../../components/ui/EmptyState";
import { openSettings } from "../settings/settings-navigation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function WorkspaceNoTabs() {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  return (
    <View className="flex-1 items-center justify-center bg-screen">
      <EmptyState
        title={translator.message("mobile.ui.allSectionsAreHidden")}
        detail={translator.message("mobile.ui.showASectionToAddItBack")}
        actionLabel={translator.message("mobile.ui.editNavigationTabs")}
        variant="plain"
        onAction={() => openSettings(navigation, "SettingsNavigation")}
      />
    </View>
  );
}
