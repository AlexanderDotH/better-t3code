import { applyPatch } from "diff";
import { describe, expect, it } from "vite-plus/test";
import { toolItemDiff } from "./toolItemDiff";

describe("tool item diffs", () => {
  it("preserves the recorded revision instead of reading the current file", () => {
    const diff = toolItemDiff({ fileName: "src/file.ts", oldStr: "before\n", newStr: "after\n" });
    expect(applyPatch("before\n", diff!)).toBe("after\n");
    expect(toolItemDiff({ fileName: "src/file.ts", diffStr: diff! })).toBe(diff);
    expect(
      toolItemDiff({ fileName: "src/file.ts", diffStr: "@@ -1 +1 @@\n-before\n+after\n" }),
    ).toContain("--- a/src/file.ts\n+++ b/src/file.ts");
  });
  it("handles raw additions, deletions, and missing recorded content", () => {
    for (const operation of ["add", "delete"] as const) {
      const patch = toolItemDiff({
        fileName: "a.ts",
        changes: [{ operation, path: "a.ts" }],
        diffStr: "line\n",
      });
      expect(applyPatch(operation === "add" ? "" : "line\n", patch!)).toBe(
        operation === "add" ? "line\n" : "",
      );
    }
    expect(toolItemDiff({ fileName: "a.ts" })).toBeNull();
  });
});
