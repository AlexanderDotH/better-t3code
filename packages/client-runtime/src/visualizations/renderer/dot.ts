import { instance } from "@viz-js/viz";
import { resolveVisualizationDiagramAppearance, VISUALIZATION_FONT_SIZE } from "../appearance.ts";
import type { VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

let engine: ReturnType<typeof instance> | undefined;

export async function renderDiagram(request: VisualizationRenderRequest): Promise<RenderedDiagram> {
  const viz = await (engine ??= instance());
  const appearance = resolveVisualizationDiagramAppearance(request.theme, request.appearance);
  return {
    svg: viz.renderString(request.source, {
      format: "svg",
      graphAttributes: {
        bgcolor: appearance.background,
        color: appearance.border,
        fontcolor: appearance.foreground,
        fontname: appearance.fontFamily,
        fontsize: VISUALIZATION_FONT_SIZE,
      },
      nodeAttributes: {
        color: appearance.border,
        fillcolor: appearance.surface,
        fontcolor: appearance.foreground,
        fontname: appearance.fontFamily,
        fontsize: VISUALIZATION_FONT_SIZE,
        style: "filled",
      },
      edgeAttributes: {
        color: appearance.mutedForeground,
        fontcolor: appearance.foreground,
        fontname: appearance.fontFamily,
        fontsize: VISUALIZATION_FONT_SIZE,
      },
    }),
  };
}
