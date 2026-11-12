import { describe, expect, it } from "vite-plus/test";
import { resolveMobileProjectGroupingSettings } from "./project-grouping.logic";

describe("mobile project grouping preferences", () => {
  it("keeps per-project overrides alongside the global and legacy grouping choices", () => {
    const overrides = { "local:/repo": "repository_path" as const };
    expect(
      resolveMobileProjectGroupingSettings({
        projectGroupingEnabled: false,
        sidebarProjectGroupingOverrides: overrides,
      }),
    ).toEqual({
      sidebarProjectGroupingMode: "separate",
      sidebarProjectGroupingOverrides: overrides,
    });
    expect(
      resolveMobileProjectGroupingSettings({
        projectGroupingMode: "repository",
        projectGroupingEnabled: false,
        sidebarProjectGroupingOverrides: overrides,
      }).sidebarProjectGroupingMode,
    ).toBe("repository");
  });
});
