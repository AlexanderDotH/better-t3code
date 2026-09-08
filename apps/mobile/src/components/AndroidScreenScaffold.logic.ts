export type AndroidScreenHeaderVariant = "page" | "sheet";

export function resolveAndroidScreenHeaderVariant(
  platform: string,
  variant: AndroidScreenHeaderVariant,
): AndroidScreenHeaderVariant | null {
  return platform === "android" ? variant : null;
}

export type NavigationUpAction = "back" | "home";

export function resolveNavigationUpAction(canGoBack: boolean): NavigationUpAction {
  return canGoBack ? "back" : "home";
}

const SCREEN_CONTENT_SPACING = 18;

export function resolveScreenContentBottomPadding(bottomInset: number): number {
  return Math.max(bottomInset, SCREEN_CONTENT_SPACING) + SCREEN_CONTENT_SPACING;
}
