import { describe, expect, it } from "vite-plus/test";

import { resolveAppearancePreferences } from "./appearancePreferences";

describe("appearancePreferences", () => {
  it("wraps code by default and preserves explicit choices", () => {
    expect(resolveAppearancePreferences(undefined).codeWordBreak).toBe(true);
    expect(resolveAppearancePreferences({ codeWordBreak: false }).codeWordBreak).toBe(false);
    expect(resolveAppearancePreferences({ codeWordBreak: true }).codeWordBreak).toBe(true);
  });
  it("migrates the legacy markdownFontSize key to baseFontSize", () => {
    expect(resolveAppearancePreferences({ markdownFontSize: 18 }).baseFontSize).toBe(18);
    expect(
      resolveAppearancePreferences({ baseFontSize: 16, markdownFontSize: 18 }).baseFontSize,
    ).toBe(16);
  });
});
