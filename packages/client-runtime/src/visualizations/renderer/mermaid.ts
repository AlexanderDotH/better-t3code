import mermaid from "mermaid";
import { VISUALIZATION_SOURCE_MAX_BYTES, type VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

let diagramId = 0;

export async function renderDiagram(
  request: VisualizationRenderRequest,
  container: HTMLElement,
): Promise<RenderedDiagram> {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: request.theme === "dark" ? "dark" : "default",
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: "Arial, sans-serif",
    suppressErrorRendering: true,
    maxTextSize: VISUALIZATION_SOURCE_MAX_BYTES,
  });
  const { svg } = await mermaid.render(`t3-diagram-${++diagramId}`, request.source, container);
  return { svg };
}
