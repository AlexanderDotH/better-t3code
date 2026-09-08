import { NativeHeaderToolbar } from "../../native/StackHeader";
import { useNavigation } from "@react-navigation/native";
import { Platform } from "react-native";

import { AndroidScreenScaffold } from "../../components/AndroidScreenScaffold";
import { useUniwindTheme } from "../../lib/useUniwindTheme";
import { EnvironmentManagerContent } from "../connection/EnvironmentManagerContent";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function SettingsEnvironmentsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const navigation = useNavigation();
  const headerIconColor = useUniwindTheme()["--color-icon"];

  return (
    <AndroidScreenScaffold
      title={translator.message("mobile.settings.environments")}
      actions={[
        {
          accessibilityLabel: translator.message("mobile.connection.addEnvironment"),
          icon: "plus",
          onPress: () =>
            navigation.navigate("SettingsSheet", {
              screen: "SettingsContent",
              params: { screen: "SettingsEnvironmentNew" },
            }),
        },
      ]}
    >
      {Platform.OS !== "android" ? (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            accessibilityLabel={translator.message("mobile.connection.addEnvironment")}
            icon="plus"
            onPress={() =>
              navigation.navigate("SettingsSheet", {
                screen: "SettingsContent",
                params: { screen: "SettingsEnvironmentNew" },
              })
            }
            separateBackground
            tintColor={headerIconColor}
          />
        </NativeHeaderToolbar>
      ) : null}
      <EnvironmentManagerContent
        onPairAgain={() =>
          navigation.navigate("SettingsSheet", {
            screen: "SettingsContent",
            params: { screen: "SettingsEnvironmentNew" },
          })
        }
        onSignIn={() => navigation.navigate("SettingsSheet", { screen: "SettingsAuth" })}
      />
    </AndroidScreenScaffold>
  );
}
