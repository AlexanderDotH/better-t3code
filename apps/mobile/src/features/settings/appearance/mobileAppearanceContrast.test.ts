import { describe, expect, it } from "vite-plus/test";
import { getMobileThemeRuntimeVariables } from "../../../lib/mobileThemeVariables";
import {
  DEFAULT_MOBILE_THEME_ID,
  flattenThemeColor,
  themeColorContrastRatio,
} from "../../../lib/mobileTheme";
import {
  applyMobileAppearanceContrast,
  normalizeMobileAppearanceContrast,
} from "./mobileAppearanceContrast";

describe("native appearance contrast", () => {
  it("keeps theme colors at 100% and clamps invalid or out-of-range preferences", () => {
    const variables = getMobileThemeRuntimeVariables(DEFAULT_MOBILE_THEME_ID, "light", "ios");
    expect(applyMobileAppearanceContrast(variables, undefined, "light")).toBe(variables);
    expect(applyMobileAppearanceContrast(variables, 100, "light")).toBe(variables);
    expect(normalizeMobileAppearanceContrast(Number.NaN)).toBe(100);
    expect(normalizeMobileAppearanceContrast(0)).toBe(50);
    expect(normalizeMobileAppearanceContrast(300)).toBe(200);
  });
  it.each(["light", "dark"] as const)(
    "reduces or boosts text and border contrast in %s themes without recoloring surfaces",
    (appearance) => {
      const variables = getMobileThemeRuntimeVariables(
        DEFAULT_MOBILE_THEME_ID,
        appearance,
        "android",
      );
      const surface = variables["--color-screen"];
      const lower = applyMobileAppearanceContrast(variables, 50, appearance);
      const higher = applyMobileAppearanceContrast(variables, 200, appearance);
      const ratio = (color: string) =>
        themeColorContrastRatio(flattenThemeColor(color, surface), surface);
      expect(ratio(lower["--color-foreground-muted"])).toBeLessThan(
        ratio(variables["--color-foreground-muted"]),
      );
      expect(ratio(higher["--color-foreground-muted"])).toBeGreaterThan(
        ratio(variables["--color-foreground-muted"]),
      );
      expect(ratio(higher["--color-border"])).toBeGreaterThan(ratio(variables["--color-border"]));
      expect(ratio(lower["--color-border"])).toBeLessThan(ratio(variables["--color-border"]));
      expect(lower["--color-screen"]).toBe(surface);
      expect(higher["--color-primary"]).toBe(variables["--color-primary"]);
    },
  );
});
