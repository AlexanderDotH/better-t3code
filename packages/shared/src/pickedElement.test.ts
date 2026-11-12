import { describe, expect, it } from "vite-plus/test";

import { buildPickedElementPayload } from "./pickedElement.ts";

describe("buildPickedElementPayload", () => {
  const base = {
    pageUrl: "https://example.com/",
    pageTitle: " Example ",
    tagName: "BUTTON",
    outerHTML: `<button>${"x".repeat(600)}</button>`,
    pickedAt: "2026-11-12T12:00:00.000Z",
  };

  it("preserves DOM context without framework metadata and normalizes source frames", () => {
    expect(buildPickedElementPayload(base)).toMatchObject({
      pageTitle: "Example",
      tagName: "button",
      selector: null,
      htmlPreview: base.outerHTML.slice(0, 500),
      componentName: null,
      source: null,
      stack: [],
      styles: "",
      pickedAt: base.pickedAt,
    });
    expect(
      buildPickedElementPayload(base, {
        selector: "#save",
        htmlPreview: "<button id=save>Save</button>",
        componentName: "SaveButton",
        styles: "color: red;",
        stack: [{ functionName: "SaveButton", fileName: "Button.tsx", lineNumber: 12 }],
      }),
    ).toMatchObject({
      selector: "#save",
      componentName: "SaveButton",
      styles: "color: red;",
      source: {
        functionName: "SaveButton",
        fileName: "Button.tsx",
        lineNumber: 12,
        columnNumber: null,
      },
    });
  });
});
