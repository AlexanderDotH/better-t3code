import { describe, expect, it } from "vite-plus/test";

import { browserStreamPoint, browserStreamRect } from "./browserStreamCoordinates";

describe("browser stream coordinates", () => {
  const viewport = { width: 1200, height: 800 };
  const frame = { width: 600, height: 400 };
  const view = { left: 10, top: 20, width: 300, height: 600 };

  it("maps letterboxed taps through frame pixels into page CSS pixels", () => {
    expect(browserStreamPoint({ x: 160, y: 320 }, view, frame, viewport)).toEqual({
      x: 600,
      y: 400,
    });
    expect(browserStreamPoint({ x: 85, y: 270 }, view, frame, viewport)).toEqual({
      x: 300,
      y: 200,
    });
    expect(browserStreamRect({ x: 300, y: 200, width: 400, height: 100 }, frame, viewport)).toEqual(
      {
        x: 150,
        y: 100,
        width: 200,
        height: 50,
      },
    );
    const wideView = { left: 20, top: 10, width: 600, height: 200 };
    expect(browserStreamPoint({ x: 320, y: 110 }, wideView, frame, viewport)).toEqual({
      x: 600,
      y: 400,
    });
    expect(browserStreamPoint({ x: 100, y: 110 }, wideView, frame, viewport)).toBeNull();
  });

  it("rejects letterbox margins and missing dimensions instead of picking a different element", () => {
    expect(browserStreamPoint({ x: 160, y: 100 }, view, frame, viewport)).toBeNull();
    expect(browserStreamPoint({ x: 0, y: 320 }, view, frame, viewport)).toBeNull();
    expect(
      browserStreamPoint({ x: 160, y: 320 }, view, { width: 0, height: 0 }, viewport),
    ).toBeNull();
    expect(browserStreamPoint({ x: 160, y: 320 }, view, frame, null)).toBeNull();
    expect(browserStreamPoint({ x: Number.NaN, y: 320 }, view, frame, viewport)).toBeNull();
  });
});
