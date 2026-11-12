import { describe, expect, it } from "vite-plus/test";
import { OrchestrationMessageContext } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { browserPickedElementContext } from "./browserPickedElementContext";
import { referencedComposerContext } from "../../lib/composerContext";

const isMessageContext = Schema.is(OrchestrationMessageContext);

describe("browser picked element context", () => {
  it("keeps element details and the linked screenshot when the composer serializes its references", () => {
    const content = browserPickedElementContext(
      {
        element: {
          pageUrl: "https://example.com/",
          pageTitle: "Example",
          tagName: "button",
          selector: "#save",
          htmlPreview: "<button id=save>Save</button>",
          styles: "color: red;",
          componentName: "SaveButton",
          source: {
            fileName: "Button.tsx",
            functionName: "SaveButton",
            lineNumber: 12,
            columnNumber: 3,
          },
          stack: [],
          pickedAt: "2026-11-12T12:00:00.000Z",
        },
        rect: { x: 20, y: 30, width: 100, height: 40 },
      },
      { id: "shot", name: "browser-element.png", sizeBytes: 123 },
      "picked",
    );
    expect(isMessageContext(content.context)).toBe(true);
    const retained = referencedComposerContext(content.text, content.context);
    expect(retained?.records).toHaveLength(2);
    expect(retained?.records[0]).toMatchObject({
      kind: "preview-annotation",
      elements: [{ selector: "#save", source: { fileName: "Button.tsx" }, styles: "color: red;" }],
      screenshotContextId: retained?.records[1]?.contextId,
    });
    expect(retained?.records[1]).toMatchObject({ kind: "image", attachmentId: "shot" });
  });
});
