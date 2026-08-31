import type { RelayDeviceRegistrationRequest } from "@t3tools/contracts/relay";
import { DEFAULT_INTERFACE_LANGUAGE_PREFERENCE } from "@t3tools/contracts";
import { resolveInterfaceLocaleSyncRecord } from "@t3tools/client-runtime/interface-language-sync";
import { resolveInterfaceLocale } from "@t3tools/shared/interfaceLanguage";

import type { Preferences } from "../../persistence/mobile-preferences";
import { supportsAgentAwarenessPush } from "./capabilities";

// Development builds are Xcode-signed and receive sandbox APNs tokens;
// preview and production builds are distribution-signed and use production
// APNs. The relay routes each device's pushes accordingly.
export function resolveApsEnvironment(appVariant: unknown): "sandbox" | "production" {
  return appVariant === "development" ? "sandbox" : "production";
}

export function makeRelayDeviceRegistrationRequest(input: {
  readonly deviceId: string;
  readonly label: string;
  readonly iosMajorVersion: number;
  readonly appVersion?: string;
  readonly bundleId?: string;
  readonly apsEnvironment?: "sandbox" | "production";
  readonly pushToken?: string;
  readonly pushToStartToken?: string;
  readonly notificationsEnabled: boolean;
  readonly preferences: Preferences;
  readonly systemLocales?: readonly string[];
}): RelayDeviceRegistrationRequest {
  const pushAvailable = supportsAgentAwarenessPush();
  const liveActivitiesEnabled = pushAvailable && input.preferences.liveActivitiesEnabled !== false;
  const preference =
    resolveInterfaceLocaleSyncRecord({
      localeRecord: input.preferences.interfaceLocaleSyncRecordV1 ?? null,
      legacyRecord: input.preferences.interfaceLanguageSyncRecord ?? null,
    })?.preference ?? DEFAULT_INTERFACE_LANGUAGE_PREFERENCE;
  const systemLocales =
    input.systemLocales ?? [new Intl.DateTimeFormat().resolvedOptions().locale].filter(Boolean);
  const language = resolveInterfaceLocale(preference, systemLocales).language;
  return {
    deviceId: input.deviceId,
    label: input.label,
    platform: "ios",
    iosMajorVersion: input.iosMajorVersion,
    language,
    appVersion: input.appVersion,
    ...(input.bundleId ? { bundleId: input.bundleId } : {}),
    ...(input.apsEnvironment ? { apsEnvironment: input.apsEnvironment } : {}),
    ...(input.pushToken ? { pushToken: input.pushToken } : {}),
    ...(input.pushToStartToken ? { pushToStartToken: input.pushToStartToken } : {}),
    preferences: {
      liveActivitiesEnabled,
      notificationsEnabled: pushAvailable && input.notificationsEnabled,
      notifyOnApproval: true,
      notifyOnInput: true,
      notifyOnCompletion: true,
      notifyOnFailure: true,
    },
  };
}
