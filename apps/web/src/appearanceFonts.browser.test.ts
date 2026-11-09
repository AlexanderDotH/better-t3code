import { describe, expect, it } from "vite-plus/test";
import { DEFAULT_CLIENT_SETTINGS } from "@t3tools/contracts";

import "~/index.css";
import { applyAppearanceFontVariables, resolveSeparateFontPreference } from "./appearanceFonts";

function renderedFontSize(style: (probe: HTMLElement) => void): string {
  const probe = document.createElement("div");
  style(probe);
  document.body.append(probe);
  try {
    return getComputedStyle(probe).fontSize;
  } finally {
    probe.remove();
  }
}

const composerFontSize = () =>
  renderedFontSize((probe) => {
    // The composer editor's own size class.
    probe.className = "text-(length:--font-size-prompt,var(--text-sm))";
  });

const touchComposerFontSize = () =>
  renderedFontSize((probe) => {
    probe.style.fontSize = "var(--font-size-prompt-touch)";
  });

describe("applyAppearanceFontVariables", () => {
  it("sizes the composer from the interface size until fonts are set separately", () => {
    const root = document.documentElement;
    const style = root.getAttribute("style");
    const preferences = {
      sans: "",
      code: "",
      composer: "",
      sizeInterface: 20,
      sizePrompt: 14,
      sizeCode: 13,
      smoothing: true,
    };
    try {
      applyAppearanceFontVariables(root, { ...preferences, separate: false });
      expect(composerFontSize()).toBe("17.5px");
      expect(touchComposerFontSize()).toBe("17.5px");

      applyAppearanceFontVariables(root, { ...preferences, separate: true });
      expect(composerFontSize()).toBe("14px");
      // iOS zooms into inputs under 16px.
      expect(touchComposerFontSize()).toBe("16px");
    } finally {
      if (style === null) root.removeAttribute("style");
      else root.setAttribute("style", style);
    }
  });

  it("retains pre-migration independent fonts unless separate fonts were explicitly disabled", () => {
    expect(resolveSeparateFontPreference(null, DEFAULT_CLIENT_SETTINGS)).toBe(false);
    for (const customization of [
      { fontFamilyComposer: "Georgia" },
      { fontFamilyTerminal: "Fira Code" },
      { fontSizePrompt: 18 },
      { fontSizeTerminal: 16 },
    ]) {
      const settings = { ...DEFAULT_CLIENT_SETTINGS, ...customization };
      expect(resolveSeparateFontPreference(null, settings)).toBe(true);
      expect(resolveSeparateFontPreference(false, settings)).toBe(false);
      expect(resolveSeparateFontPreference(true, settings)).toBe(true);
    }
  });
});
