import type { RelayClientDeviceRecord } from "@t3tools/contracts/relay";
import { createInterfaceTranslator } from "@t3tools/shared/interfaceLanguage";
import { describe, expect, it } from "vite-plus/test";

import {
  mobileClientNotificationDetail,
  mobileClientPlatformLabel,
  mobileClientUpdatedAtLabel,
} from "./MobileClientsUserProfilePage.logic";

const english = createInterfaceTranslator({ language: "en", locale: "en-US" });
const german = createInterfaceTranslator({ language: "de", locale: "de-DE" });

function device(overrides: Partial<RelayClientDeviceRecord> = {}): RelayClientDeviceRecord {
  return {
    deviceId: "device-1",
    label: "Julius’s iPhone",
    platform: "ios",
    iosMajorVersion: 18,
    appVersion: "1.2.3",
    notifications: {
      enabled: true,
      notifyOnApproval: true,
      notifyOnInput: false,
      notifyOnCompletion: true,
      notifyOnFailure: false,
    },
    liveActivities: { enabled: true },
    updatedAt: "2026-06-21T12:00:00.000Z",
    ...overrides,
  };
}

describe("mobile client presentation", () => {
  it("describes the client platform and enabled notification events", () => {
    const client = device();

    expect(mobileClientPlatformLabel(client, english)).toBe("iOS 18 · T3 Code 1.2.3");
    expect(mobileClientNotificationDetail(client, english)).toBe(
      "Alerts enabled for approvals and completions.",
    );
  });

  it("distinguishes disabled notifications from an empty event selection", () => {
    expect(
      mobileClientNotificationDetail(
        device({ notifications: { ...device().notifications, enabled: false } }),
        english,
      ),
    ).toBe("Push notifications are disabled on this device.");
    expect(
      mobileClientNotificationDetail(
        device({
          notifications: {
            enabled: true,
            notifyOnApproval: false,
            notifyOnInput: false,
            notifyOnCompletion: false,
            notifyOnFailure: false,
          },
        }),
        english,
      ),
    ).toBe("Push notifications are enabled, but no alert types are selected.");
  });

  it("handles missing app versions and invalid update timestamps", () => {
    expect(mobileClientPlatformLabel(device({ appVersion: null }), english)).toBe("iOS 18");
    expect(mobileClientUpdatedAtLabel("not-a-date", english)).toBe("Update time unavailable");
  });

  it("localizes product copy without changing device data", () => {
    expect(mobileClientPlatformLabel(device(), german)).toBe("iOS 18 · T3 Code 1.2.3");
    expect(mobileClientNotificationDetail(device(), german)).toBe(
      "Hinweise aktiviert für Freigaben und Abschlüsse.",
    );
  });
});
