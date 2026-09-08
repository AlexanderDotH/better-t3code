import {
  resolveBetterT3FeatureFlag,
  type BetterT3SettingsV1,
  type BetterT3SwitchFeatureId,
} from "@t3tools/contracts";

import { useClientSettings } from "./useSettings";

export function resolveBetterT3DeviceFeature(
  settings: BetterT3SettingsV1,
  featureId: BetterT3SwitchFeatureId,
): boolean {
  return resolveBetterT3FeatureFlag(settings, featureId);
}

export function useBetterT3DeviceFeature(featureId: BetterT3SwitchFeatureId): boolean {
  return useClientSettings((settings) =>
    resolveBetterT3DeviceFeature(settings.betterT3Device, featureId),
  );
}
