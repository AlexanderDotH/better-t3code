import { describe, expect, it } from "vite-plus/test";

import config, { IOS_APP_TRANSPORT_SECURITY, MOBILE_IOS_DEPLOYMENT_TARGET } from "./app.config";

const ANDROID_CONFIG_PLUGINS = [
  "./plugins/withAndroidCleartextTraffic.cjs",
  "./plugins/withAndroidGradleHeap.cjs",
  "./plugins/withAndroidModernPopupMenu.cjs",
  "./plugins/withAndroidModernAlertDialog.cjs",
  "./plugins/withAndroidPredictiveBackCompat.cjs",
  "./plugins/withAndroidTabletOrientation.cjs",
] as const;

describe("mobile native configuration", () => {
  it("permits local servers without globally disabling iOS transport security", () => {
    expect(IOS_APP_TRANSPORT_SECURITY).toEqual({
      NSAllowsLocalNetworking: true,
    });
    expect(config.ios?.infoPlist?.NSAppTransportSecurity).toEqual(IOS_APP_TRANSPORT_SECURITY);
  });

  it("pins the supported iOS target", () => {
    expect(MOBILE_IOS_DEPLOYMENT_TARGET).toBe("18.0");

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

  it("opts Android into predictive back while retaining the phone portrait default", () => {
    expect(config.orientation).toBe("portrait");
    expect(config.android?.predictiveBackGestureEnabled).toBe(true);
  });

  it("declares Android microphone recording for runtime voice permission requests", () => {
    expect(config.plugins).toContainEqual([
      "expo-audio",
      expect.objectContaining({
        microphonePermission: expect.stringContaining("speech"),
        recordAudioAndroid: true,
      }),
    ]);
  });

  it("keeps the image picker from removing Android microphone permission", () => {
    expect(config.plugins).toContainEqual([
      "expo-image-picker",
      expect.objectContaining({
        microphonePermission: expect.stringContaining("speech"),
      }),
    ]);
  });

  it("registers every Android native configuration plugin in dependency order", () => {
    const pluginNames = config.plugins?.filter(
      (plugin): plugin is string => typeof plugin === "string",
    );
    const androidPluginNames = pluginNames?.filter((plugin) => plugin.includes("withAndroid"));

    expect(androidPluginNames).toEqual(ANDROID_CONFIG_PLUGINS);
  });
});
