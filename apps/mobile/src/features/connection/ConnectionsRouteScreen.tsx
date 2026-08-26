import { NativeHeaderToolbar } from "../../native/StackHeader";
import { useNavigation } from "@react-navigation/native";
import { Platform } from "react-native";

import { AndroidScreenScaffold } from "../../components/AndroidScreenScaffold";
import { EnvironmentManagerContent } from "./EnvironmentManagerContent";

export function ConnectionsRouteScreen() {
  const navigation = useNavigation();

  return (
    <AndroidScreenScaffold
      title="Environments"
      actions={[
        {
          accessibilityLabel: "Add environment",
          icon: "plus",
          onPress: () => navigation.navigate("ConnectionsNew"),
        },
      ]}
    >
      {Platform.OS !== "android" ? (
        <NativeHeaderToolbar placement="right">
          <NativeHeaderToolbar.Button
            accessibilityLabel="Add environment"
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
