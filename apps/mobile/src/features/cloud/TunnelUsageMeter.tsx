import { View } from "react-native";

import { AppText } from "../../components/ui/AppText";
import { useMobileInterfaceTranslator } from "../../localization/useMobileInterfaceTranslator";
import { useManagedTunnelUsage } from "./managedRelayState";

export function TunnelUsageMeter() {
  const translator = useMobileInterfaceTranslator();
  const { used, limit } = useManagedTunnelUsage();
  if (used === null || limit === null) return null;
  return (
    <View
      className="gap-2 px-4 py-3"
      accessibilityRole="progressbar"
      accessibilityLabel={translator.message("mobile.access.tunnelUsage", { used, limit })}
      accessibilityValue={{
        min: 0,
        max: Math.max(1, limit),
        now: Math.min(used, Math.max(1, limit)),
      }}
    >
      <AppText className="text-sm text-foreground-muted">
        {translator.message("mobile.access.tunnelUsage", { used, limit })}
      </AppText>
      <View className="h-1.5 overflow-hidden rounded-full bg-subtle-strong">
        <View
          className={used >= limit ? "h-full bg-warning" : "h-full bg-primary"}
          style={{ width: `${limit === 0 ? 100 : Math.min(100, (used / limit) * 100)}%` }}
        />
      </View>
    </View>
  );
}
