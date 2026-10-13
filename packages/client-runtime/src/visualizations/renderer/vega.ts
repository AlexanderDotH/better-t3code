import { parse, View, type Spec } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";
import { resolveVisualizationAppearance, VISUALIZATION_FONT_SIZE } from "../appearance.ts";
import { parseVisualization, type VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

export async function renderDiagram(
  request: VisualizationRenderRequest,
  container: HTMLElement,
): Promise<RenderedDiagram> {
  const { spec } = parseVisualization(request.format, request.source);
  if (!spec) throw new Error("Expected a Vega or Vega-Lite JSON specification.");
  const appearance = resolveVisualizationAppearance(request.theme, request.appearance);
  const textStyle = {
    fill: appearance.foreground,
    font: appearance.fontFamily,
    fontSize: VISUALIZATION_FONT_SIZE,
  };
  const theme = {
    background: appearance.background,
    text: textStyle,
    axis: {
      domainColor: appearance.border,
      gridColor: appearance.border,
      tickColor: appearance.border,
    },
    style: {
      "guide-label": textStyle,
      "guide-title": textStyle,
      "group-title": textStyle,
      "group-subtitle": { ...textStyle, fill: appearance.mutedForeground },
    },
  };
  const input =
    request.format === "vega-lite"
      ? compile(spec as unknown as TopLevelSpec, {
          config: {
            background: appearance.background,
            text: { color: appearance.foreground },
            view: { stroke: appearance.border },
          },
        }).spec
      : (spec as Spec);
  const runtime = parse(input, theme, { ast: true });
  const view = new View(runtime, {
    renderer: "svg",
    expr: expressionInterpreter,
    loader: {
      load: async () => {
        throw new Error("External data is disabled. Embed the diagram data in the specification.");
      },
      sanitize: async () => {
        throw new Error("External resources and links are disabled.");
      },
      http: async () => {
        throw new Error("External data is disabled.");
      },
      file: async () => {
        throw new Error("External data is disabled.");
      },
    },
  });
  try {
    if (request.interactive) view.initialize(container).hover();
    await view.runAsync();
    const svg = await view.toSVG();
    if (!request.interactive) {
      view.finalize();
      return { svg };
    }
    return { svg, exportSvg: () => view.toSVG(), dispose: () => view.finalize() };
  } catch (error) {
    view.finalize();
    throw error;
  }
}
