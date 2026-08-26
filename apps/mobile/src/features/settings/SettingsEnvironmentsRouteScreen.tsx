import { NativeHeaderToolbar } from "../../native/StackHeader";
import { useNavigation } from "@react-navigation/native";
import { Platform } from "react-native";

import { AndroidScreenScaffold } from "../../components/AndroidScreenScaffold";
import { useThemeColor } from "../../lib/useThemeColor";
import { EnvironmentManagerContent } from "../connection/EnvironmentManagerContent";

export function SettingsEnvironmentsRouteScreen() {
  const navigation = useNavigation();
  const headerIconColor = useThemeColor("--color-icon");

  return (
    <AndroidScreenScaffold
      title="Environments"
      actions={[
        {
          accessibilityLabel: "Add environment",
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
            accessibilityLabel="Add environment"
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
