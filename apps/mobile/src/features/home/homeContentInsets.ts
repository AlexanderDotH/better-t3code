const ANDROID_HOME_FAB_SIZE = 56;
const ANDROID_HOME_FAB_EDGE_GAP = 16;
const ANDROID_HOME_FAB_CONTENT_GAP = 16;

export type HomeContentSurface = "empty" | "thread-list-v1" | "thread-list-v2";

export function getAndroidHomeFabLayout(safeAreaBottom: number): {
  readonly buttonBottom: number;
  readonly buttonSize: number;
  readonly contentBottomPadding: number;
} {
  const buttonBottom =
    Math.max(safeAreaBottom, ANDROID_HOME_FAB_EDGE_GAP) + ANDROID_HOME_FAB_EDGE_GAP;
  return {
    buttonBottom,
    buttonSize: ANDROID_HOME_FAB_SIZE,
    contentBottomPadding: buttonBottom + ANDROID_HOME_FAB_SIZE + ANDROID_HOME_FAB_CONTENT_GAP,
  };
}

export function getHomeContentBottomPadding(props: {
  readonly platform: "android" | "ios";
  readonly safeAreaBottom: number;
  readonly iosBottomToolbarClearance: number;
  readonly surface: HomeContentSurface;
}): number {
  if (props.platform === "android") {
    return getAndroidHomeFabLayout(props.safeAreaBottom).contentBottomPadding;
  }

  const safeBottom = Math.max(props.safeAreaBottom, 24);
  if (props.surface === "thread-list-v2") {
    return safeBottom + 96 + props.iosBottomToolbarClearance;
  }
  if (props.surface === "thread-list-v1") {
    return safeBottom + 24 + props.iosBottomToolbarClearance;
  }
  return safeBottom + props.iosBottomToolbarClearance;
}
