import { describe, expect, it } from "vite-plus/test";

import { resolveComposerEditorMetrics } from "./composerEditorMetrics";

describe("resolveComposerEditorMetrics", () => {
  it("uses the scaled body role when the editor has no explicit text metrics", () => {
    expect(resolveComposerEditorMetrics({}, { fontSize: 20, lineHeight: 29 })).toEqual({
      fontSize: 20,
      lineHeight: 29,
    });
  });

  it("preserves explicit editor metrics independently", () => {
    expect(
      resolveComposerEditorMetrics({ fontSize: 18 }, { fontSize: 20, lineHeight: 29 }),
    ).toEqual({ fontSize: 18, lineHeight: 29 });

    expect(
      resolveComposerEditorMetrics({ lineHeight: 26 }, { fontSize: 20, lineHeight: 29 }),
    ).toEqual({ fontSize: 20, lineHeight: 26 });
  });

  it("rejects non-finite metrics instead of forwarding invalid native props", () => {
    expect(
      resolveComposerEditorMetrics(
        { fontSize: Number.NaN, lineHeight: Number.POSITIVE_INFINITY },
        { fontSize: 20, lineHeight: 29 },
      ),
    ).toEqual({ fontSize: 20, lineHeight: 29 });
  });
});
