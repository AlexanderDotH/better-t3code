/** Gives standalone exports a canvas without changing the integrated preview. */
export function prepareVisualizationSvgExport(source: string, background: string): string {
  const document = new DOMParser().parseFromString(source, "image/svg+xml");
  const svg = document.documentElement;
  if (svg.localName !== "svg" || document.querySelector("parsererror")) {
    throw new Error("The renderer did not produce a valid SVG image.");
  }
  if (!svg.style.background && !svg.style.backgroundColor) {
    svg.style.backgroundColor = background;
  }
  return new XMLSerializer().serializeToString(svg);
}
