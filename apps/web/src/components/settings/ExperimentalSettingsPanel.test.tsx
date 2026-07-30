import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ExperimentalSettingsPanelView } from "./ExperimentalSettingsPanel";
import { SETTINGS_NAV_ITEMS } from "./SettingsSidebarNav";

describe("Experimental settings navigation", () => {
  it("places Experimental between Connections and Archive", () => {
    expect(SETTINGS_NAV_ITEMS.map((item) => item.label)).toEqual([
      "General",
      "Keybindings",
      "Providers",
      "Source Control",
      "Connections",
      "Experimental",
      "Archive",
    ]);
  });
});

describe("ExperimentalSettingsPanelView", () => {
  it("warns that experiments may change and defaults parallel plan implementation off", () => {
    const markup = renderToStaticMarkup(
      <ExperimentalSettingsPanelView
        parallelPlanImplementationEnabled={false}
        onParallelPlanImplementationChange={() => {}}
        onResetParallelPlanImplementation={() => {}}
      />,
    );

    expect(markup).toContain("Experimental features may change");
    expect(markup).toContain("Parallel plan implementation");
    expect(markup).toContain('aria-label="Use subagents when implementing plans"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).not.toContain("Reset parallel plan implementation to default");
  });

  it("offers a per-row reset when parallel plan implementation is enabled", () => {
    const markup = renderToStaticMarkup(
      <ExperimentalSettingsPanelView
        parallelPlanImplementationEnabled
        onParallelPlanImplementationChange={() => {}}
        onResetParallelPlanImplementation={() => {}}
      />,
    );

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("Reset parallel plan implementation to default");
  });
});
