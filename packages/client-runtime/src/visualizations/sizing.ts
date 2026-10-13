const SVG_NUMBER = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?";
const SVG_LENGTH = new RegExp(`^(${SVG_NUMBER})(?:px)?$`, "i");
const SVG_NUMBER_SEPARATOR = "(?:\\s+,?\\s*|,\\s*)";
const SVG_VIEW_BOX = new RegExp(
  `^\\s*(${SVG_NUMBER})${SVG_NUMBER_SEPARATOR}(${SVG_NUMBER})${SVG_NUMBER_SEPARATOR}(${SVG_NUMBER})${SVG_NUMBER_SEPARATOR}(${SVG_NUMBER})\\s*$`,
);

function readSvgRootAttributes(svg: string): Map<string, string> | null {
  const content = svg.replace(
    /^(?:\s|<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE(?:[^>"']|"[^"]*"|'[^']*')*>)+/i,
    "",
  );
  const root = /^<svg(?=\s|\/?>)((?:[^"'<>]|"[^"]*"|'[^']*')*)\/?>/i.exec(content);
  if (!root) return null;

  const attributes = new Map<string, string>();
  for (const attribute of root[1]!.matchAll(
    /(?:^|\s)([^\s"'=<>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
  )) {
    attributes.set(attribute[1]!.toLowerCase(), attribute[2] ?? attribute[3] ?? "");
  }
  return attributes;
}

function positiveDimensions(width: number, height: number) {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null;
}

/** Reads the root canvas size without requiring browser DOM APIs. */
export function readVisualizationSvgDimensions(
  svg: string,
): { width: number; height: number } | null {
  const attributes = readSvgRootAttributes(svg);
  if (!attributes) return null;

  const viewBox = SVG_VIEW_BOX.exec(attributes.get("viewbox") ?? "");
  if (viewBox && Number.isFinite(Number(viewBox[1])) && Number.isFinite(Number(viewBox[2]))) {
    const dimensions = positiveDimensions(Number(viewBox[3]), Number(viewBox[4]));
    if (dimensions) return dimensions;
  }

  const width = SVG_LENGTH.exec(attributes.get("width")?.trim() ?? "");
  const height = SVG_LENGTH.exec(attributes.get("height")?.trim() ?? "");
  return width && height ? positiveDimensions(Number(width[1]), Number(height[1])) : null;
}
