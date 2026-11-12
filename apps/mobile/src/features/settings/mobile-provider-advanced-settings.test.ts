import {
  DEFAULT_SERVER_SETTINGS,
  UsageLimitSourceId,
  type ServerSettings,
} from "@t3tools/contracts";
import { resolveServerBackgroundActivitySettings } from "@t3tools/shared/backgroundActivitySettings";
import * as Duration from "effect/Duration";
import { describe, expect, it } from "vite-plus/test";

import {
  buildMobileUsageLimitSourcePatch,
  providerHealthRefreshSettingsPatch,
} from "./mobile-provider-advanced-settings";

describe("provider advanced settings patches", () => {
  it("edits one hub and retains its stored key unless a replacement is entered", () => {
    const id = UsageLimitSourceId.make("hub");
    const settings = {
      ...DEFAULT_SERVER_SETTINGS,
      usageLimitSources: {
        [id]: {
          kind: "cliproxy" as const,
          url: "https://hub.example",
          managementKey: "stored-marker",
          enabled: false,
        },
      },
    };
    expect(
      buildMobileUsageLimitSourcePatch(settings, id, {
        url: " https://new.example ",
        managementKey: "",
        label: " Work ",
      }),
    ).toEqual({
      usageLimitSources: {
        [id]: {
          kind: "cliproxy",
          url: "https://new.example",
          managementKey: "stored-marker",
          enabled: false,
          label: "Work",
        },
      },
    });
    expect(
      buildMobileUsageLimitSourcePatch(settings, id, {
        url: "https://hub.example",
        managementKey: "new-key",
        label: "",
      })?.usageLimitSources?.[id]?.managementKey,
    ).toBe("new-key");
    expect(
      buildMobileUsageLimitSourcePatch(settings, id, {
        url: "file:///tmp/hub",
        managementKey: "key",
        label: "",
      }),
    ).toBeNull();
  });

  it("preserves pause, git-fetch and power-monitor overrides when changing provider probes", () => {
    const settings: ServerSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      backgroundActivity: {
        schemaVersion: 1,
        profile: "custom",
        baseProfile: "battery-saver",
        overrides: {
          pauseWhenOnBattery: false,
          automaticGitFetchInterval: Duration.minutes(7),
          hostPowerMonitorIdleInterval: Duration.minutes(20),
        },
      },
    };
    const patch = providerHealthRefreshSettingsPatch(settings, "0");
    expect(patch).not.toBeNull();
    const effective = resolveServerBackgroundActivitySettings({
      ...settings,
      backgroundActivity: {
        ...settings.backgroundActivity,
        ...patch?.backgroundActivity,
        overrides: {
          ...settings.backgroundActivity.overrides,
          ...patch?.backgroundActivity?.overrides,
        },
      },
    });
    expect(Duration.toMillis(effective.providerHealthRefreshInterval)).toBe(0);
    expect(Duration.toMillis(effective.automaticGitFetchInterval)).toBe(420000);
    expect(Duration.toMillis(effective.hostPowerMonitorIdleInterval)).toBe(1200000);
    expect(effective.pauseWhenOnBattery).toBe(false);
    expect(providerHealthRefreshSettingsPatch(settings, "-1")).toBeNull();
    expect(providerHealthRefreshSettingsPatch(settings, "NaN")).toBeNull();
  });
});
