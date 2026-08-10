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
        fetchEnabled={false}
        fetchModelAutomatic
        fetchModelControl={<button aria-label="Fetch model">Spark</button>}
        fetchModelDirty={false}
        fetchModelWarning={null}
        parallelPlanImplementationEnabled={false}
        planReviewModelControl={<button aria-label="Agent count review model">Luna</button>}
        planReviewModelDirty={false}
        onParallelPlanImplementationChange={() => {}}
        onFetchChange={() => {}}
        onResetFetchModel={() => {}}
        onResetFetch={() => {}}
        onResetParallelPlanImplementation={() => {}}
        onResetPlanReviewModel={() => {}}
      />,
    );

    expect(markup).toContain("Experimental features may change");
    expect(markup).toContain("Parallel plan implementation");
    expect(markup).toContain("Fetch");
    expect(markup).toContain("Fetch model");
    expect(markup).toContain("Auto");
    expect(markup).toContain("Spark");
    expect(markup).toContain("chooses the worker count dynamically");
    expect(markup).toContain("additional provider quota");
    expect(markup).toContain("Agent count review model");
    expect(markup).toContain('aria-label="Agent count review model"');
    expect(markup).toContain('<fieldset disabled=""');
    expect(markup).toContain('aria-label="Use subagents when implementing plans"');
    expect(markup).toContain('aria-label="Enable Fetch repository exploration"');
    expect(markup).toContain('aria-checked="false"');
    expect(markup).not.toContain("Reset Fetch to default");
    expect(markup).not.toContain("Reset Fetch model to default");
    expect(markup).not.toContain("Reset parallel plan implementation to default");
  });

  it("offers a per-row reset when parallel plan implementation is enabled", () => {
    const markup = renderToStaticMarkup(
      <ExperimentalSettingsPanelView
        fetchEnabled
        fetchModelAutomatic={false}
        fetchModelControl={<button aria-label="Fetch model">Claude Opus</button>}
        fetchModelDirty
        fetchModelWarning="The selected Fetch provider is unavailable."
        parallelPlanImplementationEnabled
        planReviewModelControl={<button aria-label="Agent count review model">Luna</button>}
        planReviewModelDirty
        onParallelPlanImplementationChange={() => {}}
        onFetchChange={() => {}}
        onResetFetchModel={() => {}}
        onResetFetch={() => {}}
        onResetParallelPlanImplementation={() => {}}
        onResetPlanReviewModel={() => {}}
      />,
    );

    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain("Reset parallel plan implementation to default");
    expect(markup).toContain("Reset Fetch to default");
    expect(markup).toContain("Reset Fetch model to default");
    expect(markup).toContain("Reset agent count review model to default");
    expect(markup).toContain("The selected Fetch provider is unavailable.");
    expect(markup).not.toContain('<fieldset disabled=""');
  });
});
