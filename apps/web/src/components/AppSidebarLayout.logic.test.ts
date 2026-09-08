import { describe, expect, it } from "vite-plus/test";

import { resolveAppSidebarPlacement } from "./AppSidebarLayout.logic";

describe("app sidebar placement", () => {
  it("keeps the default sidebar and its floating control on the left", () => {
    expect(resolveAppSidebarPlacement("left")).toEqual({
      borderClassName: "border-r",
      controlClassName: "left-[var(--workspace-controls-left)] ml-px",
      providerDirectionClassName: "flex-row",
    });
  });

  it("mirrors layout, border, and floating control when the sidebar is on the right", () => {
    expect(resolveAppSidebarPlacement("right")).toEqual({
      borderClassName: "border-l",
      controlClassName: "right-[var(--workspace-controls-right)] mr-px",
      providerDirectionClassName: "flex-row-reverse",
    });
  });
});
