import { describe, expect, it } from "vite-plus/test";
import { mobileFontOptions, resolveMobileFontFamilies } from "./mobileFontPreferences";

describe("native font preferences", () => {
  it("inherits the interface font for an unset composer without changing code and terminal defaults", () => {
    expect(resolveMobileFontFamilies({ fontFamilySans: "Georgia" }, "ios")).toMatchObject({
      sans: "Georgia",
      composer: "Georgia",
      code: "Menlo",
      terminal: "Menlo",
    });
    expect(resolveMobileFontFamilies(null, "android")).toMatchObject({
      sans: "DMSans-Regular",
      medium: "DMSans-Medium",
      bold: "DMSans-Bold",
      code: "monospace",
    });
  });
  it("keeps independently selected fonts and falls back for fonts unavailable on this platform", () => {
    expect(
      resolveMobileFontFamilies(
        {
          fontFamilySans: "Georgia",
          fontFamilyComposer: "Courier",
          fontFamilyCode: "Menlo",
          fontFamilyTerminal: "Courier",
        },
        "ios",
      ),
    ).toMatchObject({ sans: "Georgia", composer: "Courier", code: "Menlo", terminal: "Courier" });
    expect(
      resolveMobileFontFamilies({ fontFamilySans: "Georgia", fontFamilyCode: "Menlo" }, "android"),
    ).toMatchObject({ sans: "DMSans-Regular", code: "monospace" });
    expect(mobileFontOptions("android", true).some((font) => font.value === "Courier")).toBe(false);
  });
});
