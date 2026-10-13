import mermaid from "mermaid";
import { resolveVisualizationDiagramAppearance, VISUALIZATION_FONT_SIZE } from "../appearance.ts";
import { VISUALIZATION_SOURCE_MAX_BYTES, type VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

let diagramId = 0;

export async function renderDiagram(
  request: VisualizationRenderRequest,
  container: HTMLElement,
): Promise<RenderedDiagram> {
  const appearance = resolveVisualizationDiagramAppearance(request.theme, request.appearance);
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    look: "classic",
    themeVariables: {
      darkMode: request.theme === "dark",
      fontFamily: appearance.fontFamily,
      fontSize: `${VISUALIZATION_FONT_SIZE}px`,
      background: appearance.background,
      primaryColor: appearance.surface,
      primaryTextColor: appearance.foreground,
      primaryBorderColor: appearance.border,
      secondaryColor: appearance.surface,
      secondaryTextColor: appearance.foreground,
      secondaryBorderColor: appearance.border,
      tertiaryColor: appearance.background,
      tertiaryTextColor: appearance.foreground,
      tertiaryBorderColor: appearance.border,
      textColor: appearance.foreground,
      lineColor: appearance.mutedForeground,
      arrowheadColor: appearance.mutedForeground,
      edgeLabelBackground: appearance.background,
      noteBkgColor: appearance.surface,
      noteTextColor: appearance.foreground,
      noteBorderColor: appearance.border,
      activationBorderColor: appearance.border,
      useGradient: false,
      dropShadow: "none",
      nodeShadow: false,
    },
    htmlLabels: false,
    flowchart: {
      htmlLabels: false,
      padding: 12,
      nodeSpacing: 24,
      rankSpacing: 52,
      wrappingWidth: 200,
    },
    themeCSS:
      ".edge-thickness-normal{stroke-width:1.5px}.flowchart-link{stroke-linecap:round;stroke-linejoin:round}",
    fontFamily: appearance.fontFamily,
    sequence: {
      actorFontFamily: appearance.fontFamily,
      actorFontSize: VISUALIZATION_FONT_SIZE,
      messageFontFamily: appearance.fontFamily,
      messageFontSize: VISUALIZATION_FONT_SIZE,
      noteFontFamily: appearance.fontFamily,
      noteFontSize: VISUALIZATION_FONT_SIZE,
    },
    suppressErrorRendering: true,
    maxTextSize: VISUALIZATION_SOURCE_MAX_BYTES,
  });
  const { svg } = await mermaid.render(`t3-diagram-${++diagramId}`, request.source, container);
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  const background = mermaid.mermaidAPI.getConfig().themeVariables?.background;
  // Let the chat surface show through; retain an explicitly different diagram canvas.
  if (typeof background === "string" && background !== appearance.background) {
    document.documentElement.style.backgroundColor = background;
  }
  for (const rectangle of document.querySelectorAll(
    ".node > rect.basic.label-container:not([rx]):not([ry])",
  )) {
    rectangle.setAttribute("rx", "8");
    rectangle.setAttribute("ry", "8");
  }
  return { svg: new XMLSerializer().serializeToString(document.documentElement) };
}
