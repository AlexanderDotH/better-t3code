import { instance } from "@viz-js/viz";
import type { VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

let engine: ReturnType<typeof instance> | undefined;

export async function renderDiagram(request: VisualizationRenderRequest): Promise<RenderedDiagram> {
  const viz = await (engine ??= instance());
  const dark = request.theme === "dark";
  return {
    svg: viz.renderString(request.source, {
      format: "svg",
      graphAttributes: {
        bgcolor: dark ? "#171717" : "#ffffff",
        fontcolor: dark ? "#fafafa" : "#171717",
      },
      nodeAttributes: {
        color: dark ? "#e5e5e5" : "#171717",
        fontcolor: dark ? "#fafafa" : "#171717",
        fontname: "Arial",
      },
      edgeAttributes: {
        color: dark ? "#e5e5e5" : "#171717",
        fontcolor: dark ? "#fafafa" : "#171717",
        fontname: "Arial",
      },
    }),
  };
}
