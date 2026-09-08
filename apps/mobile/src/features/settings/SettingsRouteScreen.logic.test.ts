import { describe, expect, it } from "vite-plus/test";

import { resolveAgentAwarenessPlatformPresentation } from "./SettingsRouteScreen.logic";

describe("resolveAgentAwarenessPlatformPresentation", () => {
  it("explains that agent awareness settings are unavailable on Android", () => {
    expect(resolveAgentAwarenessPlatformPresentation("android")).toEqual({
      supported: false,
      subtitleMessageKey: "mobile.settings.notifications.iosOnly",
    });
  });

  it("leaves supported iOS settings unchanged", () => {
    expect(resolveAgentAwarenessPlatformPresentation("ios")).toEqual({
      supported: true,
      subtitleMessageKey: undefined,
    });
  });
});
