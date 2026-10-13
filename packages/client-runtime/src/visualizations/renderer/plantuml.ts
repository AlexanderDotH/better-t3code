import { renderToString } from "@plantuml/core";
import { resolveVisualizationDiagramAppearance, VISUALIZATION_FONT_SIZE } from "../appearance.ts";
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
  const appearance = resolveVisualizationDiagramAppearance(request.theme, request.appearance);
  // Set the canvas after root styles, which also supply the default node background.
  const defaults = `<style>
root {
BackgroundColor ${appearance.surface}
FontColor ${appearance.foreground}
FontName ${appearance.fontFamily.replace(/[\r\n{}]/g, " ")}
FontSize ${VISUALIZATION_FONT_SIZE}
LineColor ${appearance.border}
Shadowing 0
}
arrow {
LineColor ${appearance.mutedForeground}
}
</style>
skinparam backgroundColor ${appearance.background}
`;
  const source = request.source.replace(/(^\s*@start\w+[^\n]*\n)/, (header) => header + defaults);
  const svg = await new Promise<string>((resolve, reject) => {
    renderToString(source.split(/\r?\n/), resolve, (message) => reject(new Error(message)));
  });
  if (/Syntax Error\?|An error has occurred/i.test(svg))
    throw new Error("PlantUML could not parse this diagram. Check the source syntax.");
  return { svg };
}
