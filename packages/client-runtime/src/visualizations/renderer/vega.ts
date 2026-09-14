import { parse, View, type Spec } from "vega";
import { compile, type TopLevelSpec } from "vega-lite";
import { expressionInterpreter } from "vega-interpreter";
import { parseVisualization, type VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

export async function renderDiagram(
  request: VisualizationRenderRequest,
  container: HTMLElement,
): Promise<RenderedDiagram> {
  const { spec } = parseVisualization(request.format, request.source);
  if (!spec) throw new Error("Expected a Vega or Vega-Lite JSON specification.");
  const theme = {
    background: request.theme === "dark" ? "#171717" : "#ffffff",
    axis: {
      labelColor: request.theme === "dark" ? "#eeeeee" : "#171717",
      titleColor: request.theme === "dark" ? "#eeeeee" : "#171717",
    },
    legend: {
      labelColor: request.theme === "dark" ? "#eeeeee" : "#171717",
      titleColor: request.theme === "dark" ? "#eeeeee" : "#171717",
    },
    title: { color: request.theme === "dark" ? "#eeeeee" : "#171717" },
  };
  const input =
    request.format === "vega-lite"
      ? compile(spec as unknown as TopLevelSpec, { config: theme }).spec
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
