import type { Preferences } from "../../../persistence/mobile-preferences";

export type MobileFontPreferenceKey =
  | "fontFamilySans"
  | "fontFamilyComposer"
  | "fontFamilyCode"
  | "fontFamilyTerminal";

export function mobileFontOptions(platform: string, monospace: boolean) {
  const systemSans = platform === "ios" ? "System" : "sans-serif";
  const systemMono = platform === "ios" ? "Menlo" : "monospace";
  return [
    { value: "", label: null, family: monospace ? systemMono : "DMSans-Regular" },
    { value: "DMSans-Regular", label: "DM Sans", family: "DMSans-Regular" },
    {
      value: systemSans,
      label: platform === "ios" ? "San Francisco" : null,
      family: systemSans,
    },
    {
      value: platform === "ios" ? "Georgia" : "serif",
      label: platform === "ios" ? "Georgia" : null,
      family: platform === "ios" ? "Georgia" : "serif",
    },
    { value: systemMono, label: platform === "ios" ? "Menlo" : null, family: systemMono },
    ...(platform === "ios" ? [{ value: "Courier", label: "Courier", family: "Courier" }] : []),
  ];
}

export function resolveMobileFontFamilies(
  preferences: Pick<Preferences, MobileFontPreferenceKey> | null,
  platform: string,
) {
  const resolve = (key: MobileFontPreferenceKey, fallback: string) => {
    const saved = preferences?.[key];
    return saved && mobileFontOptions(platform, false).some((font) => font.value === saved)
      ? saved
      : fallback;
  };
  const sans = resolve("fontFamilySans", "DMSans-Regular");
  const monospace = platform === "ios" ? "Menlo" : "monospace";
  return {
    sans,
    medium: sans === "DMSans-Regular" ? "DMSans-Medium" : sans,
    bold: sans === "DMSans-Regular" ? "DMSans-Bold" : sans,
    composer: resolve("fontFamilyComposer", sans),
    code: resolve("fontFamilyCode", monospace),
    terminal: resolve("fontFamilyTerminal", monospace),
  };
}
