import { useNavigation } from "@react-navigation/native";

import type { ConnectedEnvironmentSummary } from "../../state/remote-runtime-types";
import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { environmentPairingPrefill } from "./environmentSections";

export function useEnvironmentRecoveryNavigation(input: {
  readonly pairingRoute: "ConnectionsNew" | "SettingsEnvironmentNew";
  readonly onChangeConnectionPairingUrl: (pairingUrl: string) => void;
}) {
  const navigation = useNavigation();
  return {
    onPairAgain: (environment: ConnectedEnvironmentSummary) => {
      input.onChangeConnectionPairingUrl(environmentPairingPrefill(environment) ?? "");
      navigation.navigate(input.pairingRoute);
    },
    onSignIn: hasCloudPublicConfig() ? () => navigation.navigate("SettingsAuth") : undefined,
  };
}
