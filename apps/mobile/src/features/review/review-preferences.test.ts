import { describe, expect, it } from "vite-plus/test";
import {
  reviewDiffPreferences,
  reviewTargetSectionId,
  filterWhitespaceRows,
  splitReviewRows,
} from "./review-preferences";
import type { ReviewRenderableLineRow } from "./reviewModel";

const defaults = {
  diffIgnoreWhitespace: false,
  diffFilesCollapsed: false,
  diffColorScheme: "red-green" as const,
};
const line = (
  id: string,
  change: ReviewRenderableLineRow["change"],
  content: string,
): ReviewRenderableLineRow => ({
  id,
  kind: "line",
  change,
  content,
  oldLineNumber: 1,
  newLineNumber: 1,
  additionTokenIndex: null,
  deletionTokenIndex: null,
  comparison: null,
});

describe("mobile review preferences and targets", () => {
  it("uses defaults only for unset values and keeps explicit false values", () => {
    expect(reviewDiffPreferences(undefined, defaults)).toEqual(defaults);
    expect(
      reviewDiffPreferences(
        { diffIgnoreWhitespace: true, diffFilesCollapsed: true, diffColorScheme: "blue-orange" },
        defaults,
      ),
    ).toEqual({
      diffIgnoreWhitespace: true,
      diffFilesCollapsed: true,
      diffColorScheme: "blue-orange",
    });
    expect(
      reviewDiffPreferences(
        { diffFilesCollapsed: false },
        { ...defaults, diffFilesCollapsed: true },
      ).diffFilesCollapsed,
    ).toBe(false);
  });
  it("resolves checkpoint, Git section and commit revisions", () => {
    expect(reviewTargetSectionId(3)).toBe("turn:3");
    expect(reviewTargetSectionId("3")).toBe("turn:3");
    expect(reviewTargetSectionId("turn:4")).toBe("turn:4");
    expect(reviewTargetSectionId("working-tree")).toBe("git:working-tree");
    expect(reviewTargetSectionId("a".repeat(40))).toBe("git:commit");
    expect(reviewTargetSectionId(undefined)).toBeNull();
  });
  it("ignores whitespace-only replacements without hiding substantive changes", () => {
    const rows = [
      line("d1", "delete", "  const a = 1;"),
      line("a1", "add", "const a = 1;"),
      line("c", "context", "same"),
      line("d2", "delete", "old"),
      line("a2", "add", "new"),
    ];
    expect(filterWhitespaceRows(rows, false)).toBe(rows);
    expect(filterWhitespaceRows(rows, true).map((row) => row.id)).toEqual(["c", "d2", "a2"]);
  });
  it("pairs split replacements and preserves unmatched additions", () => {
    const old = line("d", "delete", "old");
    const next = line("a", "add", "new");
    const added = line("b", "add", "more");
    expect(splitReviewRows([old, next, added])).toEqual([
      { id: "d:a", left: old, right: next },
      { id: ":b", left: null, right: added },
    ]);
  });
});
