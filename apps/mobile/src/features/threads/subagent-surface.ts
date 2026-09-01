export interface SubagentSurfacePresentation {
  readonly animationType: "fade" | "slide";
  readonly hardwareAccelerated: boolean;
  readonly presentationStyle: "fullScreen" | "pageSheet";
  readonly removeClippedSubviews: false;
  readonly safeAreaEdges: ReadonlyArray<"top" | "right" | "bottom" | "left">;
}

export function subagentSurfacePresentation(
  platform: "android" | "ios",
): SubagentSurfacePresentation {
  if (platform === "android") {
    return {
      animationType: "fade",
      hardwareAccelerated: true,
      presentationStyle: "fullScreen",
      removeClippedSubviews: false,
      safeAreaEdges: ["top", "right", "bottom", "left"],
    };
  }
  return {
    animationType: "slide",
    hardwareAccelerated: false,
    presentationStyle: "pageSheet",
    removeClippedSubviews: false,
    safeAreaEdges: ["top", "bottom"],
  };
}
