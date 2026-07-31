import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ExperimentalSettingsPanelView } from "./ExperimentalSettingsPanel";
import { SETTINGS_NAV_ITEMS } from "./SettingsSidebarNav";

describe("Experimental settings navigation", () => {
  it("places Experimental immediately after Connections", () => {
    const labels = SETTINGS_NAV_ITEMS.map((item) => item.label);
    const connectionsIndex = labels.indexOf("Connections");

    expect(connectionsIndex).toBeGreaterThanOrEqual(0);
    expect(labels[connectionsIndex + 1]).toBe("Experimental");
  });
});

describe("ExperimentalSettingsPanelView", () => {
  it("warns that experiments may change and defaults parallel plan implementation off", () => {
    const markup = renderToStaticMarkup(
      <ExperimentalSettingsPanelView
        parallelPlanImplementationEnabled={false}
        planReviewModelControl={<button aria-label="Agent count review model">Luna</button>}
        planReviewModelDirty={false}
        onParallelPlanImplementationChange={() => {}}
        onResetParallelPlanImplementation={() => {}}
        onResetPlanReviewModel={() => {}}
      />,
    );

    expect(markup).toContain("Experimental features may change");
    expect(markup).toContain("Parallel plan implementation");
    expect(markup).toContain("Agent count review model");
    expect(markup).toContain('aria-label="Agent count review model"');
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup).toContain('aria-label="Use subagents when implementing plans"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).not.toContain("Reset parallel plan implementation to default");
  });

  it("offers a per-row reset when parallel plan implementation is enabled", () => {
    const markup = renderToStaticMarkup(
      <ExperimentalSettingsPanelView
        parallelPlanImplementationEnabled
        planReviewModelControl={<button aria-label="Agent count review model">Luna</button>}
        planReviewModelDirty
        onParallelPlanImplementationChange={() => {}}
        onResetParallelPlanImplementation={() => {}}
        onResetPlanReviewModel={() => {}}
      />,
    );

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("Reset parallel plan implementation to default");
    expect(markup).toContain("Reset agent count review model to default");
    expect(markup).not.toContain('<fieldset disabled=""');
  });
});
