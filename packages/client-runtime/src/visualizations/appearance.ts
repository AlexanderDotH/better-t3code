import "culori/css";
import { converter, formatHex, interpolate, parse, wcagContrast, type Rgb } from "culori/fn";
import type { VisualizationAppearance, VisualizationRenderRequest } from "./model.ts";

export const VISUALIZATION_FONT_SIZE = 14;

const DEFAULT_APPEARANCE = {
  light: {
    fontFamily: "system-ui, sans-serif",
    background: "#ffffff",
    foreground: "#171717",
    mutedForeground: "#737373",
    surface: "#f5f5f5",
    border: "#d4d4d4",
  },
  dark: {
    fontFamily: "system-ui, sans-serif",
    background: "#171717",
    foreground: "#eeeeee",
    mutedForeground: "#a3a3a3",
    surface: "#262626",
    border: "#525252",
  },
} satisfies Record<VisualizationRenderRequest["theme"], VisualizationAppearance>;

const convertToRgb = converter("rgb");

function clampChannel(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readColor(value: string): Rgb | null {
  const parsed = parse(value.trim().toLowerCase());
  if (!parsed) return null;
  const color = convertToRgb(parsed);
  if (![color.r, color.g, color.b, color.alpha ?? 1].every(Number.isFinite)) return null;
  return {
    mode: "rgb",
    r: clampChannel(color.r),
    g: clampChannel(color.g),
    b: clampChannel(color.b),
    alpha: clampChannel(color.alpha ?? 1),
  };
}

function compositeColor(value: string, background: Rgb, fallback: string): Rgb {
  const color = readColor(value) ?? readColor(fallback)!;
  const alpha = color.alpha ?? 1;
  return {
    mode: "rgb",
    r: color.r * alpha + background.r * (1 - alpha),
    g: color.g * alpha + background.g * (1 - alpha),
    b: color.b * alpha + background.b * (1 - alpha),
  };
}

/** Flattens CSS palette colors for renderers that only accept opaque sRGB values. */
export function normalizeVisualizationAppearance(
  appearance: VisualizationAppearance,
  theme: VisualizationRenderRequest["theme"] = "light",
): VisualizationAppearance {
  const fallback = DEFAULT_APPEARANCE[theme];
  const background = compositeColor(
    appearance.background,
    readColor(fallback.background)!,
    fallback.background,
  );
  const opaqueColor = (value: string, fallbackColor: string) =>
    formatHex(compositeColor(value, background, fallbackColor));
  return {
    ...(appearance.presentation === "better-t3" ? { presentation: "better-t3" as const } : {}),
    fontFamily: appearance.fontFamily.trim() || fallback.fontFamily,
    background: formatHex(background),
    foreground: opaqueColor(appearance.foreground, fallback.foreground),
    mutedForeground: opaqueColor(appearance.mutedForeground, fallback.mutedForeground),
    surface: opaqueColor(appearance.surface, fallback.surface),
    border: opaqueColor(appearance.border, fallback.border),
  };
}

export function resolveVisualizationAppearance(
  theme: VisualizationRenderRequest["theme"],
  appearance?: VisualizationAppearance,
): VisualizationAppearance {
  return normalizeVisualizationAppearance(appearance ?? DEFAULT_APPEARANCE[theme], theme);
}

/** Keeps thin diagram outlines visible even when the app uses faint surface borders. */
export function resolveVisualizationDiagramAppearance(
  theme: VisualizationRenderRequest["theme"],
  appearance?: VisualizationAppearance,
): VisualizationAppearance {
  const resolved = resolveVisualizationAppearance(theme, appearance);
  const minimumContrast = 2;
  if (wcagContrast(resolved.border, resolved.surface) >= minimumContrast) return resolved;
  const blend = interpolate([resolved.border, resolved.foreground], "rgb");
  const blendSteps = 10;
  for (let step = 1; step <= blendSteps; step += 1) {
    const border = formatHex(blend(step / blendSteps));
    if (wcagContrast(border, resolved.surface) >= minimumContrast) return { ...resolved, border };
  }
  return resolved;
}

export function visualizationPreviewCacheKey(request: VisualizationRenderRequest): string {
  const appearance = resolveVisualizationAppearance(request.theme, request.appearance);
  return JSON.stringify([
    request.format,
    request.source,
    request.theme,
    appearance.presentation ?? null,
    appearance.fontFamily,
    appearance.background,
    appearance.foreground,
    appearance.mutedForeground,
    appearance.surface,
    appearance.border,
  ]);
}
