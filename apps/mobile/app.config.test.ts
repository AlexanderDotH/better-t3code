import { describe, expect, it } from "vite-plus/test";

import config, { IOS_APP_TRANSPORT_SECURITY, MOBILE_IOS_DEPLOYMENT_TARGET } from "./app.config";

describe("mobile native configuration", () => {
  it("permits local servers without globally disabling iOS transport security", () => {
    expect(IOS_APP_TRANSPORT_SECURITY).toEqual({
      NSAllowsLocalNetworking: true,
    });
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual(IOS_APP_TRANSPORT_SECURITY);
  });

  it("pins the supported iOS target and required platform plugins", () => {
    expect(MOBILE_IOS_DEPLOYMENT_TARGET).toBe("18.0");
    expect(config.plugins).toContain("./plugins/withAndroidCleartextTraffic.cjs");

    const buildProperties = config.plugins?.find(
      (plugin) => Array.isArray(plugin) && plugin[0] === "expo-build-properties",
    );
    expect(buildProperties).toEqual([
      "expo-build-properties",
      expect.objectContaining({
        ios: expect.objectContaining({ deploymentTarget: MOBILE_IOS_DEPLOYMENT_TARGET }),
      }),
    ]);
  });
});
