import { describe, expect, it } from "vite-plus/test";
import type { PullRequestReviewThread } from "@t3tools/contracts";
import type { NativeReviewDiffData } from "../review/nativeReviewDiffAdapter";
import {
  annotatePullRequestDiff,
  buildReviewCommentRange,
  reviewPositionLabel,
} from "./pullRequestDiffComments";
const data: NativeReviewDiffData = {
  rows: [
    { kind: "file", id: "header", fileId: "f", filePath: "a.ts" },
    { kind: "line", id: "old", fileId: "f", change: "delete", oldLineNumber: 2 },
    { kind: "line", id: "new", fileId: "f", change: "add", newLineNumber: 2 },
  ],
  files: [{ id: "f", path: "a.ts", language: "typescript", additions: 1, deletions: 1 }],
  commentTargetsByRowId: new Map(),
  rowIdByCommentLineId: new Map(),
  additions: 1,
  deletions: 1,
};
const thread: PullRequestReviewThread = {
  id: "t",
  path: "a.ts",
  line: 2,
  side: "left",
  isResolved: false,
  isOutdated: false,
  comments: [],
};
describe("PR comments in continuous native diffs", () => {
  it("builds ordered range positions on either diff side and falls back for single-line hosts", () => {
    const rows = [
      {
        kind: "line" as const,
        id: "a",
        fileId: "f",
        oldLineNumber: 4,
        newLineNumber: 6,
        content: "context",
      },
      {
        kind: "line" as const,
        id: "b",
        fileId: "f",
        change: "delete" as const,
        oldLineNumber: 5,
        content: "removed",
      },
      {
        kind: "line" as const,
        id: "c",
        fileId: "f",
        change: "add" as const,
        newLineNumber: 7,
        content: "added",
      },
    ];
    expect(buildReviewCommentRange(rows, "c", "a")).toMatchObject({
      startPosition: { kind: "context", oldLine: 4, newLine: 6, side: "right" },
      position: { kind: "added", newLine: 7 },
      code: "context\nadded",
      rowIds: ["a", "c"],
    });
    expect(buildReviewCommentRange(rows, "b", "a")).toMatchObject({
      startPosition: { kind: "context", oldLine: 4, newLine: 6, side: "left" },
      position: { kind: "deleted", oldLine: 5 },
      code: "context\nremoved",
    });
    expect(buildReviewCommentRange(rows, "a", "c", false)).toEqual({
      position: { kind: "added", newLine: 7 },
      code: "added",
      rowIds: ["a", "c"],
    });
    expect(buildReviewCommentRange(rows, "a", "a")?.startPosition).toBeUndefined();
    const shiftedContext = [
      rows[0]!,
      {
        kind: "line" as const,
        id: "ctx",
        fileId: "f",
        oldLineNumber: 5,
        newLineNumber: 9,
        content: "context after removal",
      },
    ];
    expect(buildReviewCommentRange(shiftedContext, "a", "ctx", true, "left")).toMatchObject({
      startPosition: { kind: "context", oldLine: 4, newLine: 6, side: "left" },
      position: { kind: "context", oldLine: 5, newLine: 9, side: "left" },
    });
    expect(buildReviewCommentRange(rows, "b", "c")).toBeNull();
    expect(
      buildReviewCommentRange([...rows, { ...rows[2]!, id: "other", fileId: "g" }], "a", "other"),
    ).toBeNull();
    expect(
      buildReviewCommentRange([...rows, { ...rows[2]!, id: "gap", newLineNumber: 10 }], "a", "gap"),
    ).toBeNull();
  });
  it("returns unannotated data unchanged without reading or indexing rows", () => {
    const unannotated = {
      ...data,
      get rows(): NativeReviewDiffData["rows"] {
        throw new Error("Empty annotation must not read rows");
      },
    };
    expect(annotatePullRequestDiff(unannotated, [], [], undefined)).toBe(unannotated);
    expect(annotatePullRequestDiff(data, [], [], undefined).rows).toBe(data.rows);
  });

  it("anchors old/new lines separately despite identical line numbers", () => {
    const annotated = annotatePullRequestDiff(
      data,
      [thread, { ...thread, id: "right", side: "right" }],
      [],
      "abc",
    );
    expect(annotated.rows.map((row) => row.id)).toEqual([
      "header",
      "old",
      "discussion:t",
      "new",
      "discussion:right",
    ]);
  });
  it("keeps outdated and unloaded anchors off the current code", () => {
    const annotated = annotatePullRequestDiff(
      data,
      [
        { ...thread, isOutdated: true },
        { ...thread, id: "missing", path: "b.ts" },
      ],
      [
        {
          id: "draft",
          path: "a.ts",
          position: { kind: "added", newLine: 2 },
          body: "Feedback",
          code: "",
          headSha: "old",
        },
      ],
      "new",
    );
    expect(annotated.rows).toEqual(data.rows);
  });
  it("supports file-level threads and current private drafts without changing code IDs", () => {
    const annotated = annotatePullRequestDiff(
      data,
      [{ ...thread, line: null }],
      [
        {
          id: "draft",
          path: "a.ts",
          position: { kind: "added", newLine: 2 },
          body: "Feedback",
          code: "",
          headSha: "abc",
        },
      ],
      "abc",
    );
    expect(annotated.rows.map((row) => row.id)).toEqual([
      "header",
      "discussion:t",
      "old",
      "new",
      "draft:draft",
    ]);
    expect(annotated.commentTargetsByRowId).toBe(data.commentTargetsByRowId);
  });
  it("counts a single-comment discussion in the singular", () => {
    const annotated = annotatePullRequestDiff(
      data,
      [
        { ...thread, commentCount: 1 },
        { ...thread, id: "right", side: "right", commentCount: 2 },
      ],
      [],
      "abc",
    );
    expect(
      annotated.rows
        .filter((row) => row.kind === "comment")
        .map((row) => row.commentText?.split("\n").at(-1)),
    ).toEqual(["1 comment · Tap to open", "2 comments · Tap to open"]);
  });
  it("uses the old line number for left-side context when the line numbers differ", () => {
    const position = { kind: "context" as const, side: "left" as const, oldLine: 7, newLine: 8 };
    const annotated = annotatePullRequestDiff(
      {
        ...data,
        rows: [
          ...data.rows,
          { kind: "line", id: "context", fileId: "f", oldLineNumber: 7, newLineNumber: 8 },
        ],
      },
      [],
      [{ id: "left", path: "a.ts", position, headSha: "abc", code: "", body: "Feedback" }],
      "abc",
    );
    expect(annotated.rows.at(-1)?.id).toBe("draft:left");
    expect(reviewPositionLabel(position)).toBe("Old line 7");
  });
});
