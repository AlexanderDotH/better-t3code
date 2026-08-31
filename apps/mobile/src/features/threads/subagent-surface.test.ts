import { describe, expect, it } from "vite-plus/test";

import { subagentSurfacePresentation } from "./subagent-surface";

describe("mobile subagent surface", () => {
  it("uses an accelerated full-screen surface without list clipping on Android", () => {
    expect(subagentSurfacePresentation("android")).toEqual({
      animationType: "fade",
      hardwareAccelerated: true,
      presentationStyle: "fullScreen",
      removeClippedSubviews: false,
      safeAreaEdges: ["top", "right", "bottom", "left"],
    });
  });

  it("retains the sheet presentation on iOS", () => {
    expect(subagentSurfacePresentation("ios")).toEqual({
      animationType: "slide",
      hardwareAccelerated: false,
      presentationStyle: "pageSheet",
      removeClippedSubviews: false,
      safeAreaEdges: ["top", "bottom"],
    });
  });
});
