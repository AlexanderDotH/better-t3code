import {
  DEFAULT_CLIENT_SETTINGS,
  MAX_APPEARANCE_CONTRAST,
  MIN_APPEARANCE_CONTRAST,
} from "@t3tools/contracts";
import {
  flattenThemeColor,
  themeColorWithAlpha,
  type MobileThemeAppearance,
  type MobileThemeVariable,
  type MobileThemeVariables,
} from "../../../lib/mobileTheme";

export function normalizeMobileAppearanceContrast(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(MIN_APPEARANCE_CONTRAST, Math.min(MAX_APPEARANCE_CONTRAST, Math.round(value)))
    : DEFAULT_CLIENT_SETTINGS.appearanceContrast;
}

const CONTRAST_SURFACES = {
  "--color-foreground": "--color-screen",
  "--color-foreground-muted": "--color-screen",
  "--color-foreground-secondary": "--color-screen",
  "--color-foreground-tertiary": "--color-screen",
  "--color-icon": "--color-screen",
  "--color-icon-muted": "--color-screen",
  "--color-icon-subtle": "--color-screen",
  "--color-placeholder": "--color-screen",
  "--color-header-foreground": "--color-header",
  "--color-drawer-foreground": "--color-drawer",
  "--color-drawer-foreground-muted": "--color-drawer",
  "--color-md-body": "--color-thread-canvas",
  "--color-md-strong": "--color-thread-canvas",
  "--color-secondary-foreground": "--color-secondary",
  "--color-user-bubble-foreground": "--color-user-bubble",
} as const;

export function applyMobileAppearanceContrast(
  variables: MobileThemeVariables,
  value: number | undefined,
  appearance: MobileThemeAppearance,
): MobileThemeVariables {
  const contrast = normalizeMobileAppearanceContrast(value);
  if (contrast === DEFAULT_CLIENT_SETTINGS.appearanceContrast) return variables;
  const result = { ...variables };
  const target = appearance === "dark" ? "#ffffff" : "#000000";
  const boost = Math.max(0, contrast - 100);
  for (const [key, color] of Object.entries(variables)) {
    const variable = key as MobileThemeVariable;
    const surface = CONTRAST_SURFACES[key as keyof typeof CONTRAST_SURFACES];
    if (surface) {
      const base =
        contrast < 100
          ? flattenThemeColor(themeColorWithAlpha(color, contrast / 100), variables[surface])
          : color;
      result[variable] =
        boost > 0
          ? flattenThemeColor(themeColorWithAlpha(base, 100 / (100 + boost)), target)
          : base;
    } else if (key.includes("border") || key === "--color-separator") {
      const base = flattenThemeColor(color, variables["--color-screen"]);
      result[variable] =
        boost > 0
          ? flattenThemeColor(
              themeColorWithAlpha(base, 100 / (100 + boost / 4)),
              variables["--color-foreground"],
            )
          : themeColorWithAlpha(base, contrast / 100);
    }
  }
  return result;
}
