import { renderToString } from "@plantuml/core";
import type { VisualizationRenderRequest } from "../model.ts";
import type { RenderedDiagram } from "./runtime.ts";

export async function renderDiagram(request: VisualizationRenderRequest): Promise<RenderedDiagram> {
  const host = globalThis as typeof globalThis & {
    PLANTUML_STDLIB_LOADER?: (
      name: string,
      success: () => void,
      failure: (error: string) => void,
    ) => boolean;
  };
  host.PLANTUML_STDLIB_LOADER = (name, _success, failure) => {
    failure(`Additional PlantUML libraries are not available: ${name}`);
    return true;
  };
  const source =
    request.theme === "dark"
      ? request.source.replace(
          /(^\s*@start\w+[^\n]*\n)/,
          "$1skinparam backgroundColor #171717\n<style>\nroot {\nBackgroundColor #262626\nFontColor #eeeeee\nLineColor #aaaaaa\n}\n</style>\n",
        )
      : request.source;
  const svg = await new Promise<string>((resolve, reject) => {
    renderToString(source.split(/\r?\n/), resolve, (message) => reject(new Error(message)));
  });
  if (/Syntax Error\?|An error has occurred/i.test(svg))
    throw new Error("PlantUML could not parse this diagram. Check the source syntax.");
  return { svg };
}
