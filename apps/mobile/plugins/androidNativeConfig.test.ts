import * as NodeModule from "node:module";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import {
  XML,
  type AndroidManifest,
  type ExportedConfig,
  type ExportedConfigWithProps,
} from "expo/config-plugins";

import { describe, expect, it } from "vite-plus/test";

type AndroidResourceItem = { _: string; $: { name: string } };
type AndroidStyle = {
  $: { name: string; parent?: string };
  item?: Array<AndroidResourceItem>;
};
type AndroidColor = { _: string; $: { name: string } };
type AndroidResources = {
  resources: {
    color?: Array<AndroidColor>;
    style?: Array<AndroidStyle>;
  };
};

type NetworkSecurityPlugin = (config: ExportedConfig) => ExportedConfig;
type GradleProperty = {
  key?: string;
  type: string;
  value?: string;
};
type GradleHeapPlugin = {
  configureGradleProperties(properties: Array<GradleProperty>): Array<GradleProperty>;
};
type MainActivityPlugin = {
  patchMainActivity(contents: string, language?: string): string;
};
type ResourcePlugin = {
  configureColors(resources: AndroidResources, appearance: "light" | "night"): AndroidResources;
  configureStyles(resources: AndroidResources): AndroidResources;
  drawables: Readonly<Record<string, string>>;
};

const require = NodeModule.createRequire(import.meta.url);
const loadCjs = (path: string): unknown => require(path);

const networkSecurityPlugin = loadCjs(
  "./withAndroidNetworkSecurityConfig.cjs",
) as NetworkSecurityPlugin;
const gradleHeapPlugin = loadCjs("./withAndroidGradleHeap.cjs") as GradleHeapPlugin;
const predictiveBackPlugin = loadCjs("./withAndroidPredictiveBackCompat.cjs") as MainActivityPlugin;
const tabletOrientationPlugin = loadCjs("./withAndroidTabletOrientation.cjs") as MainActivityPlugin;
const popupMenuPlugin = loadCjs("./withAndroidModernPopupMenu.cjs") as ResourcePlugin;
const alertDialogPlugin = loadCjs("./withAndroidModernAlertDialog.cjs") as ResourcePlugin;

const MAIN_ACTIVITY_TEMPLATE = `package com.t3tools.t3code

import android.os.Bundle

class MainActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun invokeDefaultOnBackPressed() {
    super.invokeDefaultOnBackPressed()
  }
}
`;

function countOccurrences(contents: string, marker: string): number {
  return contents.split(marker).length - 1;
}

function findStyle(resources: AndroidResources, name: string): AndroidStyle | undefined {
  return resources.resources.style?.find((style) => style.$.name === name);
}

function findStyleItem(style: AndroidStyle | undefined, name: string): string | undefined {
  return style?.item?.find((item) => item.$.name === name)?._;
}

function findColor(resources: AndroidResources, name: string): string | undefined {
  return resources.resources.color?.find((color) => color.$.name === name)?._;
}

function createThemeResources(): AndroidResources {
  return {
    resources: {
      style: [
        {
          $: { name: "AppTheme", parent: "Theme.AppCompat.DayNight.NoActionBar" },
          item: [],
        },
      ],
    },
  };
}

function androidModInput<Results>(
  config: ExportedConfig,
  modResults: Results,
  modName: "manifest" | "dangerous",
  projectRoot = "/project",
): ExportedConfigWithProps<Results> {
  return {
    ...config,
    modResults,
    modRawConfig: config,
    modRequest: {
      platform: "android",
      modName,
      projectRoot,
      platformProjectRoot: NodePath.join(projectRoot, "android"),
      introspect: false,
    },
  };
}

describe("Android native config plugins", () => {
  it("attaches the HTTP and private-CA policy without duplicating manifest attributes", async () => {
    const config = networkSecurityPlugin(
      networkSecurityPlugin({ name: "Native config test", slug: "native-config-test" }),
    );
    const manifestMod = config.mods?.android?.manifest;
    if (manifestMod === undefined) throw new Error("Network security manifest mod is missing");
    const manifest: AndroidManifest = {
      manifest: {
        $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
        queries: [],
        application: [{ $: { "android:name": ".MainApplication", "android:label": "T3 Code" } }],
      },
    };
    await manifestMod(androidModInput(config, manifest, "manifest"));
    const configured = structuredClone(manifest);
    await manifestMod(androidModInput(config, manifest, "manifest"));

    expect(manifest).toEqual(configured);
    expect(manifest.manifest.application?.[0]?.$).toEqual({
      "android:name": ".MainApplication",
      "android:label": "T3 Code",
      "android:networkSecurityConfig": "@xml/network_security_config",
    });
  });

  it("fails clearly when the manifest application anchor disappears", async () => {
    const config = networkSecurityPlugin({
      name: "Native config test",
      slug: "native-config-test",
    });
    const manifestMod = config.mods?.android?.manifest;
    if (manifestMod === undefined) throw new Error("Network security manifest mod is missing");
    const manifest: AndroidManifest = {
      manifest: {
        $: { "xmlns:android": "http://schemas.android.com/apk/res/android" },
        queries: [],
      },
    };
    await expect(manifestMod(androidModInput(config, manifest, "manifest"))).rejects.toThrowError(
      /missing the application element/,
    );
  });

  it("generates an idempotent policy allowing HTTP and trusting system and user certificates", async () => {
    const projectRoot = await NodeFSP.mkdtemp(
      NodePath.join(NodeOS.tmpdir(), "t3-android-network-policy-"),
    );
    try {
      const config = networkSecurityPlugin({
        name: "Native config test",
        slug: "native-config-test",
      });
      const resourceMod = config.mods?.android?.dangerous;
      if (resourceMod === undefined) throw new Error("Network security resource mod is missing");
      const xmlPath = NodePath.join(
        projectRoot,
        "android",
        "app",
        "src",
        "main",
        "res",
        "xml",
        "network_security_config.xml",
      );
      await resourceMod(androidModInput<unknown>(config, undefined, "dangerous", projectRoot));
      const generated = await NodeFSP.readFile(xmlPath, "utf8");
      await resourceMod(androidModInput<unknown>(config, undefined, "dangerous", projectRoot));
      expect(await NodeFSP.readFile(xmlPath, "utf8")).toBe(generated);
      expect(await XML.parseXMLAsync(generated)).toEqual({
        "network-security-config": {
          "base-config": [
            {
              $: { cleartextTrafficPermitted: "true" },
              "trust-anchors": [
                { certificates: [{ $: { src: "system" } }, { $: { src: "user" } }] },
              ],
            },
          ],
        },
      });
    } finally {
      await NodeFSP.rm(projectRoot, { recursive: true, force: true });
    }
  });

  it("replaces stale Gradle heap settings once while preserving unrelated properties", () => {
    const properties: Array<GradleProperty> = [
      { type: "comment", value: "Generated by Expo" },
      { type: "property", key: "org.gradle.jvmargs", value: "-Xmx2048m" },
      { type: "property", key: "android.useAndroidX", value: "true" },
      { type: "property", key: "org.gradle.jvmargs", value: "-Xmx1024m" },
    ];

    const configured = gradleHeapPlugin.configureGradleProperties(properties);
    const reapplied = gradleHeapPlugin.configureGradleProperties(configured);

    expect(reapplied).toEqual(configured);
    expect(reapplied.filter((property) => property.key === "org.gradle.jvmargs")).toEqual([
      {
        type: "property",
        key: "org.gradle.jvmargs",
        value: "-Xmx4096m -XX:MaxMetaspaceSize=1024m",
      },
    ]);
    expect(reapplied).toContainEqual({ type: "comment", value: "Generated by Expo" });
    expect(reapplied).toContainEqual({
      type: "property",
      key: "android.useAndroidX",
      value: "true",
    });
  });

  it("patches predictive back and tablet orientation once in either plugin order", () => {
    const predictiveThenTablet = tabletOrientationPlugin.patchMainActivity(
      predictiveBackPlugin.patchMainActivity(MAIN_ACTIVITY_TEMPLATE),
    );
    const tabletThenPredictive = predictiveBackPlugin.patchMainActivity(
      tabletOrientationPlugin.patchMainActivity(MAIN_ACTIVITY_TEMPLATE),
    );

    for (const patched of [predictiveThenTablet, tabletThenPredictive]) {
      const reapplied = tabletOrientationPlugin.patchMainActivity(
        predictiveBackPlugin.patchMainActivity(patched),
      );

      expect(reapplied).toBe(patched);
      expect(countOccurrences(patched, "predictiveBackCompatCallback =")).toBe(1);
      expect(countOccurrences(patched, "applyTabletOrientation()")).toBe(3);
      expect(countOccurrences(patched, "override fun onConfigurationChanged")).toBe(1);
      expect(patched).toContain("Build.VERSION.SDK_INT < Build.VERSION_CODES.BAKLAVA");
      expect(patched).toContain("ActivityInfo.SCREEN_ORIENTATION_FULL_USER");
      expect(patched).toContain("ActivityInfo.SCREEN_ORIENTATION_PORTRAIT");
    }
  });

  it("fails closed when Expo MainActivity anchors drift or the template stops being Kotlin", () => {
    expect(() =>
      predictiveBackPlugin.patchMainActivity(MAIN_ACTIVITY_TEMPLATE, "java"),
    ).toThrowError(/must be Kotlin/);
    expect(() =>
      predictiveBackPlugin.patchMainActivity(
        MAIN_ACTIVITY_TEMPLATE.replace(
          "super.onCreate(null)",
          "super.onCreate(savedInstanceState)",
        ),
      ),
    ).toThrowError(/super\.onCreate call/);
    expect(() =>
      predictiveBackPlugin.patchMainActivity(
        MAIN_ACTIVITY_TEMPLATE.replace("override fun invokeDefaultOnBackPressed() {", ""),
      ),
    ).toThrowError(/invokeDefaultOnBackPressed/);
    expect(() =>
      tabletOrientationPlugin.patchMainActivity(
        MAIN_ACTIVITY_TEMPLATE.replace(
          "class MainActivity : ReactActivity() {",
          "class MainActivity",
        ),
      ),
    ).toThrowError(/MainActivity class declaration/);
  });

  it("generates idempotent popup styles, palettes, and drawable resources", () => {
    const resources = createThemeResources();

    popupMenuPlugin.configureStyles(resources);
    popupMenuPlugin.configureColors(resources, "light");
    const once = structuredClone(resources);
    popupMenuPlugin.configureStyles(resources);
    popupMenuPlugin.configureColors(resources, "light");

    expect(resources).toEqual(once);
    expect(findStyleItem(findStyle(resources, "AppTheme"), "popupMenuStyle")).toBe(
      "@style/AppPopupMenu",
    );
    expect(findStyleItem(findStyle(resources, "AppPopupMenu"), "android:popupBackground")).toBe(
      "@drawable/popup_menu_background",
    );
    expect(findColor(resources, "popup_menu_background")).toBe("#F7F7F7");
    expect(findColor(resources, "popup_menu_item_text")).toBe("#262626");
    expect(Object.keys(popupMenuPlugin.drawables).sort()).toEqual([
      "ic_menu_check.xml",
      "popup_menu_background.xml",
      "popup_menu_check_button.xml",
      "popup_menu_submenu_arrow.xml",
    ]);
    expect(popupMenuPlugin.drawables["popup_menu_submenu_arrow.xml"]).toContain(
      "@color/popup_menu_item_text",
    );
  });

  it("generates idempotent alert styles, day/night palettes, and drawable resources", () => {
    const lightResources = createThemeResources();
    const nightResources: AndroidResources = { resources: {} };

    alertDialogPlugin.configureStyles(lightResources);
    alertDialogPlugin.configureColors(lightResources, "light");
    alertDialogPlugin.configureColors(nightResources, "night");
    const once = structuredClone(lightResources);
    alertDialogPlugin.configureStyles(lightResources);
    alertDialogPlugin.configureColors(lightResources, "light");

    expect(lightResources).toEqual(once);
    expect(findStyleItem(findStyle(lightResources, "AppTheme"), "alertDialogTheme")).toBe(
      "@style/AppAlertDialog",
    );
    expect(
      findStyleItem(findStyle(lightResources, "AppAlertDialog"), "android:windowBackground"),
    ).toBe("@drawable/alert_dialog_background");
    expect(findColor(lightResources, "alert_dialog_background")?.toUpperCase()).toBe("#FFFFFF");
    expect(findColor(nightResources, "alert_dialog_background")?.toUpperCase()).toBe("#111111");
    expect(alertDialogPlugin.drawables["alert_dialog_background.xml"]).toContain(
      "@color/alert_dialog_background",
    );
  });
});
