export interface ComposerEditorMetrics {
  readonly fontSize: number;
  readonly lineHeight: number;
}

function finiteMetric(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function resolveComposerEditorMetrics(
  textStyle: {
    readonly fontSize?: unknown;
    readonly lineHeight?: unknown;
  },
  fallback: ComposerEditorMetrics,
): ComposerEditorMetrics {
  return {
    fontSize: finiteMetric(textStyle.fontSize, fallback.fontSize),
    lineHeight: finiteMetric(textStyle.lineHeight, fallback.lineHeight),
  };
}
