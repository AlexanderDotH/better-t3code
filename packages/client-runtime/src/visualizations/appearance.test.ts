import { describe, expect, it } from "vite-plus/test";
import { wcagContrast } from "culori/fn";
import {
  normalizeVisualizationAppearance,
  resolveVisualizationAppearance,
  resolveVisualizationDiagramAppearance,
  visualizationPreviewCacheKey,
} from "./appearance.ts";
import {
  isVisualizationRequest,
  VISUALIZATION_CHANNEL,
  type VisualizationAppearance,
  type VisualizationRenderRequest,
} from "./model.ts";

const APPEARANCE: VisualizationAppearance = {
  fontFamily: '"Inter", sans-serif',
  background: "#ffffff",
  foreground: "#171717",
  mutedForeground: "#737373",
  surface: "#f5f5f5",
  border: "#d4d4d4",
};
const REQUEST: VisualizationRenderRequest = {
  channel: VISUALIZATION_CHANNEL,
  type: "render",
  requestId: "preview-1",
  format: "mermaid",
  source: "flowchart LR\nA --> B",
  theme: "light",
  appearance: APPEARANCE,
};

describe("visualization appearance", () => {
  it("provides opaque palettes and a system sans font for requests without appearance", () => {
    const light = resolveVisualizationAppearance("light");
    const dark = resolveVisualizationAppearance("dark");
    expect(light.fontFamily).toBe("system-ui, sans-serif");
    expect(dark.fontFamily).toBe(light.fontFamily);
    expect(light.background).toBe("#ffffff");
    expect(dark.background).toBe("#171717");
    expect(dark.foreground).not.toBe(light.foreground);
    for (const palette of [light, dark]) {
      for (const [role, value] of Object.entries(palette)) {
        if (role !== "fontFamily") expect(value).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it.each([
    {
      theme: "dark",
      background: "#0f0f0f",
      surface: "#181818",
      border: "#343434",
      foreground: "#e5e5e5",
    },
    {
      theme: "light",
      background: "#f4f4f4",
      surface: "#ffffff",
      border: "#e3e3e3",
      foreground: "#222222",
    },
  ] as const)("keeps diagram outlines legible on $theme surfaces", ({ theme, ...colors }) => {
    const requested = { ...APPEARANCE, ...colors };
    expect(wcagContrast(requested.border, requested.surface)).toBeLessThan(2);
    const diagram = resolveVisualizationDiagramAppearance(theme, requested);
    expect(wcagContrast(diagram.border, diagram.surface)).toBeGreaterThanOrEqual(2);
    expect({ ...diagram, border: requested.border }).toEqual(requested);
  });

  it("retains already legible diagram borders", () => {
    const requested = { ...APPEARANCE, border: "#515151" };
    expect(resolveVisualizationDiagramAppearance("light", requested)).toEqual(requested);
  });

  it("converts hex, named, RGB, HSL, and OKLCH colors to opaque sRGB hex", () => {
    const normalized = normalizeVisualizationAppearance({
      fontFamily: '  "Inter", sans-serif  ',
      background: "oklch(1 0 0)",
      foreground: "RGB(255, 0, 0)",
      mutedForeground: "hsl(120 100% 25%)",
      surface: "#AbC",
      border: "rebeccapurple",
    });
    expect(normalized).toEqual({
      fontFamily: '"Inter", sans-serif',
      background: "#ffffff",
      foreground: "#ff0000",
      mutedForeground: "#008000",
      surface: "#aabbcc",
      border: "#663399",
    });
    expect(normalizeVisualizationAppearance(normalized)).toEqual(normalized);
  });

  it("composites the background on the theme default and each role on the resolved background", () => {
    const appearance = {
      ...APPEARANCE,
      background: "rgb(0 0 0 / 50%)",
      foreground: "rgb(255 255 255 / 50%)",
      mutedForeground: "transparent",
      surface: "#ffffff80",
      border: "rgba(0, 0, 0, 0.5)",
    };
    const light = normalizeVisualizationAppearance(appearance);
    expect(light).toEqual({
      fontFamily: APPEARANCE.fontFamily,
      background: "#808080",
      foreground: "#bfbfbf",
      mutedForeground: "#808080",
      surface: "#c0c0c0",
      border: "#404040",
    });
    const dark = resolveVisualizationAppearance("dark", appearance);
    expect(dark.background).toBe("#0c0c0c");
    expect(dark.foreground).toBe("#858585");
    expect(dark.mutedForeground).toBe(dark.background);
    expect(
      resolveVisualizationAppearance("dark", { ...appearance, background: "transparent" })
        .background,
    ).toBe(resolveVisualizationAppearance("dark").background);
  });

  it("falls back per invalid color and retains valid roles", () => {
    const fallback = resolveVisualizationAppearance("dark");
    expect(
      resolveVisualizationAppearance("dark", {
        fontFamily: "   ",
        background: "var(--background)",
        foreground: "currentColor",
        mutedForeground: "not-a-color",
        surface: "#123456",
        border: "rgb(1e999 0 0)",
      }),
    ).toEqual({ ...fallback, surface: "#123456" });
  });

  it("clamps out-of-gamut colors and alpha before producing renderer colors", () => {
    expect(
      normalizeVisualizationAppearance({
        ...APPEARANCE,
        foreground: "color(srgb 1.2 -0.2 0.5)",
        surface: "rgba(255, 0, 0, 2)",
        border: "rgba(0, 0, 0, -1)",
      }),
    ).toMatchObject({ foreground: "#ff0080", surface: "#ff0000", border: "#ffffff" });
  });
});

describe("visualization render appearance validation", () => {
  it("accepts old requests and complete appearance payloads", () => {
    const { appearance: _appearance, ...legacyRequest } = REQUEST;
    expect(isVisualizationRequest(legacyRequest)).toBe(true);
    expect(isVisualizationRequest(REQUEST)).toBe(true);
  });

  it("rejects invalid appearance containers, missing roles, and non-string roles", () => {
    for (const appearance of [null, "dark", [], {}]) {
      expect(isVisualizationRequest({ ...REQUEST, appearance })).toBe(false);
    }
    for (const role of Object.keys(APPEARANCE)) {
      const incomplete: Record<string, unknown> = { ...APPEARANCE };
      delete incomplete[role];
      expect(isVisualizationRequest({ ...REQUEST, appearance: incomplete })).toBe(false);
      expect(isVisualizationRequest({ ...REQUEST, appearance: { ...APPEARANCE, [role]: 0 } })).toBe(
        false,
      );
    }
  });
});

describe("visualization preview cache keys", () => {
  it("keeps Better T3 previews separate through normalization and mode changes", () => {
    const appearance = normalizeVisualizationAppearance({
      ...APPEARANCE,
      presentation: "better-t3",
    });
    const request = { ...REQUEST, appearance };
    expect(isVisualizationRequest(request)).toBe(true);
    expect(appearance.presentation).toBe("better-t3");
    expect(visualizationPreviewCacheKey(request)).not.toBe(visualizationPreviewCacheKey(REQUEST));
    expect(visualizationPreviewCacheKey({ ...request, appearance: APPEARANCE })).toBe(
      visualizationPreviewCacheKey(REQUEST),
    );
    expect(
      isVisualizationRequest({
        ...request,
        appearance: { ...appearance, presentation: "invalid" },
      }),
    ).toBe(false);
  });

  it("shares rendered previews across request IDs and interactive modes", () => {
    expect(
      visualizationPreviewCacheKey({ ...REQUEST, requestId: "preview-2", interactive: true }),
    ).toBe(visualizationPreviewCacheKey(REQUEST));
  });

  it("invalidates previews for source, format, theme, font, and every palette role", () => {
    const key = visualizationPreviewCacheKey(REQUEST);
    for (const request of [
      { ...REQUEST, format: "dot" as const },
      { ...REQUEST, source: `${REQUEST.source}\nB --> C` },
      { ...REQUEST, theme: "dark" as const },
    ]) {
      expect(visualizationPreviewCacheKey(request)).not.toBe(key);
    }
    for (const role of Object.keys(APPEARANCE)) {
      const appearance = { ...APPEARANCE, [role]: role === "fontFamily" ? "Arial" : "#123456" };
      expect(visualizationPreviewCacheKey({ ...REQUEST, appearance })).not.toBe(key);
    }
  });

  it("keys equivalent CSS colors and absent default appearances consistently", () => {
    expect(
      visualizationPreviewCacheKey({
        ...REQUEST,
        appearance: { ...APPEARANCE, background: "white" },
      }),
    ).toBe(visualizationPreviewCacheKey(REQUEST));
    const { appearance: _appearance, ...legacyRequest } = REQUEST;
    expect(visualizationPreviewCacheKey(legacyRequest)).toBe(
      visualizationPreviewCacheKey({
        ...REQUEST,
        appearance: resolveVisualizationAppearance(REQUEST.theme),
      }),
    );
  });
});
