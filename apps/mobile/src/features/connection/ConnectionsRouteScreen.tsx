import { Toolbar } from "../../components/ui/Toolbar";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";

import { useNavigation } from "@react-navigation/native";
import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { Platform, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AndroidScreenHeader } from "../../components/ui/AndroidScreenHeader";
import { useRemoteConnections } from "../../state/use-remote-environment-registry";
import { LocalEnvironmentList } from "./LocalEnvironmentList";
import { PullRequestRoutingSettings } from "./PullRequestRoutingSettings";
import { LinkedEnvironmentsSection } from "./LinkedEnvironmentsSection";
import { useEnvironmentRecoveryNavigation } from "./useEnvironmentRecoveryNavigation";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";

export function ConnectionsRouteScreen() {
  const translator = useMobileInterfaceTranslator();
  const {
    connectedEnvironments,
    onChangeConnectionPairingUrl,
    onReconnectEnvironment,
    onRemoveEnvironmentPress,
    onSetEnvironmentEnabled,
    onUpdateEnvironment,
  } = useRemoteConnections();
  const navigation = useNavigation();
  const recovery = useEnvironmentRecoveryNavigation({
    pairingRoute: "ConnectionsNew",
    onChangeConnectionPairingUrl,
  });
  const insets = useSafeAreaInsets();
  const [expandedId, setExpandedId] = useState<EnvironmentId | null>(null);
  const handleToggle = (environmentId: EnvironmentId) => {
    setExpandedId((prev) => (prev === environmentId ? null : environmentId));
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      {Platform.OS === "android" ? (
        <AndroidScreenHeader
          title={translator.message("mobile.settings.environments")}
          onBack={() => navigation.goBack()}
          actions={[
            {
              accessibilityLabel: translator.message("mobile.connection.addEnvironment"),
              icon: "plus",
              onPress: () => navigation.navigate("ConnectionsNew"),
            },
          ]}
        />
      ) : (
        <Toolbar placement="right">
          <Toolbar.Button
            icon="plus"
            onPress={() => navigation.navigate("ConnectionsNew")}
            separateBackground
          />
        </Toolbar>
      )}
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        showsVerticalScrollIndicator={false}
        className="flex-1"
        contentContainerStyle={{
          paddingBottom: Math.max(insets.bottom, 18) + 18,
          paddingHorizontal: 20,
          paddingTop: 16,
        }}
      >
        <LocalEnvironmentList
          environments={connectedEnvironments}
          expandedId={expandedId}
          onToggle={handleToggle}
          onReconnect={onReconnectEnvironment}
          onRemove={onRemoveEnvironmentPress}
          onSetEnabled={onSetEnvironmentEnabled}
          onUpdate={onUpdateEnvironment}
          onPairAgain={recovery.onPairAgain}
          onSignIn={recovery.onSignIn}
        />
        {connectedEnvironments
          .filter((environment) => environment.connectionState === "connected")
          .map((environment) => (
            <LinkedEnvironmentsSection
              key={environment.environmentId}
              environmentId={environment.environmentId}
              environmentLabel={environment.environmentLabel}
            />
          ))}
        <PullRequestRoutingSettings />
      </ScrollView>
    </View>
  );
}
