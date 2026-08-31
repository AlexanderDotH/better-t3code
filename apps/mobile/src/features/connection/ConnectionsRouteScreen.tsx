import { NativeHeaderToolbar } from "../../native/StackHeader";
import { useNavigation } from "@react-navigation/native";
import { Platform } from "react-native";

import { AndroidScreenScaffold } from "../../components/AndroidScreenScaffold";
import { EnvironmentManagerContent } from "./EnvironmentManagerContent";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ConnectionsRouteScreen() {
  const navigation = useNavigation();
  const translator = useMobileInterfaceTranslator();

  return (
    <AndroidScreenScaffold
      title={translator.message("mobile.settings.environments")}
      actions={[
        {
          accessibilityLabel: translator.message("mobile.connection.addEnvironment"),
          icon: "plus",
          onPress: () => navigation.navigate("ConnectionsNew"),
        },
      ]}
    >
      {Platform.OS !== "android" ? (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            accessibilityLabel={translator.message("mobile.connection.addEnvironment")}
            icon="plus"
            onPress={() => navigation.navigate("ConnectionsNew")}
            separateBackground
          />
        </NativeHeaderToolbar>
      ) : null}
      <EnvironmentManagerContent
        onPairAgain={() => navigation.navigate("ConnectionsNew")}
        onSignIn={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
      />
    </AndroidScreenScaffold>
  );
}
