import type { RelayClientDeviceRecord } from "@t3tools/contracts/relay";
import type { InterfaceMessageKey, InterfaceTranslator } from "@t3tools/shared/interfaceLanguage";

const NOTIFICATION_PREFERENCES = [
  ["notifyOnApproval", "mobileClients.preference.approvals"],
  ["notifyOnInput", "mobileClients.preference.inputRequests"],
  ["notifyOnCompletion", "mobileClients.preference.completions"],
  ["notifyOnFailure", "mobileClients.preference.failures"],
] as const satisfies ReadonlyArray<
  readonly [keyof RelayClientDeviceRecord["notifications"], InterfaceMessageKey]
>;

export function mobileClientPlatformLabel(
  device: RelayClientDeviceRecord,
  translator: InterfaceTranslator,
): string {
  return translator.message(
    device.appVersion
      ? "mobileClients.platform.withVersion"
      : "mobileClients.platform.withoutVersion",
    {
      iosVersion: device.iosMajorVersion,
      ...(device.appVersion ? { appVersion: device.appVersion } : {}),
    },
  );
}

export function mobileClientNotificationDetail(
  device: RelayClientDeviceRecord,
  translator: InterfaceTranslator,
): string {
  if (!device.notifications.enabled) {
    return translator.message("mobileClients.notifications.disabled");
  }

  const enabledPreferences = NOTIFICATION_PREFERENCES.flatMap(([preference, key]) =>
    device.notifications[preference] ? [translator.message(key)] : [],
  );
  if (enabledPreferences.length === 0) {
    return translator.message("mobileClients.notifications.noTypes");
  }
  return translator.message("mobileClients.notifications.alertsEnabled", {
    types: translator.list(enabledPreferences),
  });
}

export function mobileClientUpdatedAtLabel(
  updatedAt: string,
  translator: InterfaceTranslator,
): string {
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) {
    return translator.message("mobileClients.updated.unavailable");
  }
  return translator.message("mobileClients.updated.label", {
    date: translator.date(date, { timeStyle: "short" }),
  });
}
