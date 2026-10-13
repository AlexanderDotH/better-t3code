import { describe, expect, it } from "vite-plus/test";
import { readVisualizationSvgDimensions } from "./sizing.ts";

describe("visualization SVG dimensions", () => {
  it("reads wide and tall root viewBoxes regardless of rendered viewport attributes", () => {
    expect(
      readVisualizationSvgDimensions(
        '<svg width="100%" height="200" viewBox="0 0 1600 200"></svg>',
      ),
    ).toEqual({ width: 1600, height: 200 });
    expect(
      readVisualizationSvgDimensions('<svg width="300" height="100%" viewBox="-20 -40 120 1200"/>'),
    ).toEqual({ width: 120, height: 1200 });
  });

  it("accepts comma-separated and scientific viewBox numbers", () => {
    expect(readVisualizationSvgDimensions("<svg viewBox='-1e2, +.5e1, 1.2E3, 4e2'/>")).toEqual({
      width: 1200,
      height: 400,
    });
    expect(readVisualizationSvgDimensions('<svg viewBox="0,0 1600, 200"/>')).toEqual({
      width: 1600,
      height: 200,
    });
  });

  it("falls back to positive numeric or px dimensions when the viewBox is absent or invalid", () => {
    for (const viewBox of [
      "",
      ' viewBox="0 0 -10 20"',
      ' viewBox="0 0 Infinity 20"',
      ' viewBox="1e999 0 10 20"',
      ' viewBox="0 0 10"',
    ]) {
      expect(
        readVisualizationSvgDimensions(`<svg width=" 640px " height='3.6e2'${viewBox}/>`),
      ).toEqual({
        width: 640,
        height: 360,
      });
    }
  });

  it("only uses attributes of the root SVG", () => {
    expect(
      readVisualizationSvgDimensions(
        '<svg><svg viewBox="0 0 1600 200" width="1600" height="200"/></svg>',
      ),
    ).toBeNull();
    expect(
      readVisualizationSvgDimensions(
        '<svg width="300" height="200"><svg viewBox="0 0 1 1"/></svg>',
      ),
    ).toEqual({ width: 300, height: 200 });
    expect(readVisualizationSvgDimensions('<div><svg viewBox="0 0 100 100"/></div>')).toBeNull();
    expect(
      readVisualizationSvgDimensions("<svg data-example=\"viewBox='0 0 100 100'\"/>"),
    ).toBeNull();
  });

  it("skips SVG export declarations and comments without reading fake root attributes", () => {
    expect(
      readVisualizationSvgDimensions(`
        <?xml version="1.0" encoding="UTF-8"?>
        <!-- <svg viewBox="0 0 1 1"/> -->
        <!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
        <svg aria-label="a > b" viewBox="0 0 640 360"></svg>`),
    ).toEqual({ width: 640, height: 360 });
  });

  it("returns a safe fallback for percentages, nonfinite values, and invalid dimensions", () => {
    for (const svg of [
      "",
      '<svg width="100%" height="360"/>',
      '<svg width="640" height="50%"/>',
      '<svg width="640pt" height="360pt"/>',
      '<svg width="0" height="360"/>',
      '<svg width="-640" height="360"/>',
      '<svg width="1e999" height="360"/>',
      '<svg width="640" height="NaN"/>',
      '<svg viewBox="0 0 0 360"/>',
      '<svg viewBox="0 0 640 -360"/>',
      '<svg viewBox="0 0 640 360 1"/>',
      '<svg viewBox="0,,0,640,360"/>',
      '<svg viewBox="0 0 1e999 360"/>',
    ]) {
      expect(readVisualizationSvgDimensions(svg)).toBeNull();
    }
  });
});
