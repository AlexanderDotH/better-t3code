import type { FileDiffMetadata } from "@pierre/diffs";
import type { PullRequestReviewGuideExcerpt } from "@t3tools/contracts";
import { fileDiffRows } from "@t3tools/client-runtime/review-guide-tour";
import { buildReviewCommentRange } from "../pullRequestDiffComments";

export function guideExcerptComment(
  file: FileDiffMetadata | undefined,
  excerpt: PullRequestReviewGuideExcerpt,
  supportsRange: boolean,
) {
  if (!file) return null;
  const rows = fileDiffRows(file).map((row, index) => ({
    kind: "line" as const,
    id: String(index),
    fileId: excerpt.path,
    change:
      row.kind === "addition"
        ? ("add" as const)
        : row.kind === "deletion"
          ? ("delete" as const)
          : ("context" as const),
    oldLineNumber: row.oldLine,
    newLineNumber: row.newLine,
    content: row.text,
  }));
  const line = (row: (typeof rows)[number]) =>
    excerpt.side === "new" ? row.newLineNumber : row.oldLineNumber;
  const first = rows.find((row) => line(row) === excerpt.start);
  const last = rows.find((row) => line(row) === excerpt.end);
  if (!first || !last) return null;
  const side = excerpt.side === "old" ? ("left" as const) : ("right" as const);
  const range = buildReviewCommentRange(rows, first.id, last.id, supportsRange, side);
  if (!range) return null;
  return {
    path: excerpt.path,
    ...(file.prevName && file.prevName !== excerpt.path ? { oldPath: file.prevName } : {}),
    position: range.position.kind === "context" ? { ...range.position, side } : range.position,
    ...(range.startPosition
      ? {
          startPosition:
            range.startPosition.kind === "context"
              ? { ...range.startPosition, side }
              : range.startPosition,
        }
      : {}),
    code: range.code,
  };
}
