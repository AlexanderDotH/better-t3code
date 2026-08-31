import { useRoute, type RouteProp } from "@react-navigation/native";
import { EnvironmentId } from "@t3tools/contracts";
import { ActivityIndicator, View } from "react-native";

import {
  AndroidScreenScaffold,
  ScreenScaffoldScrollView,
} from "../../components/AndroidScreenScaffold";
import { AppText as Text } from "../../components/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useEnvironmentServerConfig } from "../../state/entities";
import { useEnvironmentQuery } from "../../state/query";
import { serverEnvironment } from "../../state/server";
import { SettingsSection } from "./components/SettingsSection";
import { formatMobileResourceBytes, supportsMobileResourceDiagnostics } from "./better-t3-settings";

type ResourceDiagnosticsParams = {
  SettingsBetterT3ResourceDiagnostics: { readonly environmentId: EnvironmentId };
};

function DiagnosticValue(props: { readonly label: string; readonly value: string }) {
  return (
    <View className="flex-row items-center gap-4 border-t border-border-subtle p-4 first:border-t-0">
      <Text className="min-w-0 flex-1 text-base text-foreground">{props.label}</Text>
      <Text className="shrink-0 text-right text-sm text-foreground-muted">{props.value}</Text>
    </View>
  );
}

export function SettingsBetterT3ResourceDiagnosticsRouteScreen() {
  const route =
    useRoute<RouteProp<ResourceDiagnosticsParams, "SettingsBetterT3ResourceDiagnostics">>();
  const translator = useMobileInterfaceTranslator();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const config = useEnvironmentServerConfig(environmentId);
  const supported = supportsMobileResourceDiagnostics(
    config?.environment.capabilities.resourceDiagnosticsVersion,
  );
  const protection = useEnvironmentQuery(
    supported ? serverEnvironment.resourceProtection({ environmentId, input: {} }) : null,
  );
  const title = translator.message("settings.betterT3.mobile.diagnostics.title");

  return (
    <AndroidScreenScaffold title={title}>
      <NativeStackScreenOptions options={{ title }} />
      <ScreenScaffoldScrollView>
        <Text className="px-2 text-sm leading-normal text-foreground-muted">
          {translator.message("settings.betterT3.mobile.diagnostics.description")}
        </Text>
        {!supported ? (
          <SettingsSection card title={title}>
            <Text className="p-4 text-sm text-foreground-muted">
              {translator.message("settings.betterT3.mobile.diagnostics.unsupported")}
            </Text>
          </SettingsSection>
        ) : protection.data === null ? (
          <SettingsSection card title={title}>
            <View className="flex-row items-center gap-3 p-4">
              {protection.isPending ? <ActivityIndicator size="small" /> : null}
              <Text className="min-w-0 flex-1 text-sm text-foreground-muted">
                {protection.error ??
                  translator.message("settings.betterT3.mobile.diagnostics.loading")}
              </Text>
            </View>
          </SettingsSection>
        ) : (
          <SettingsSection card title={title}>
            <DiagnosticValue
              label={translator.message("settings.betterT3.mobile.diagnostics.state")}
              value={translator.message(
                `settings.betterT3.mobile.diagnostics.state.${protection.data.state}`,
              )}
            />
            <DiagnosticValue
              label={translator.message("settings.betterT3.mobile.diagnostics.memory")}
              value={translator.message("settings.betterT3.mobile.diagnostics.memoryValue", {
                available: formatMobileResourceBytes(protection.data.availableMemoryBytes),
                total: formatMobileResourceBytes(protection.data.totalMemoryBytes),
              })}
            />
            <DiagnosticValue
              label={translator.message("settings.betterT3.mobile.diagnostics.reserved")}
              value={formatMobileResourceBytes(protection.data.reservedMemoryBytes)}
            />
            <DiagnosticValue
              label={translator.message("settings.betterT3.mobile.diagnostics.coreReserve")}
              value={formatMobileResourceBytes(protection.data.coreReserveBytes)}
            />
            <DiagnosticValue
              label={translator.message("settings.betterT3.mobile.diagnostics.waitingStarts")}
              value={String(protection.data.waitingStarts)}
            />
          </SettingsSection>
        )}
      </ScreenScaffoldScrollView>
    </AndroidScreenScaffold>
  );
}
