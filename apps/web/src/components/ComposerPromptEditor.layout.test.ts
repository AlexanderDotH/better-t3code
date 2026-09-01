import { describe, expect, it } from "vite-plus/test";

import composerPromptEditorSource from "./ComposerPromptEditor.tsx?raw";

describe("ComposerPromptEditor layout", () => {
  it("wraps long paths within the available composer width", () => {
    expect(composerPromptEditorSource).toContain(
      "overflow-y-auto whitespace-pre-wrap wrap-anywhere",
    );
  });
});
