import type { PullRequestReviewPosition, PullRequestReviewThread } from "@t3tools/contracts";
import type { NativeReviewDiffRow } from "../diffs/nativeReviewDiffSurface";
import type { NativeReviewDiffData } from "../review/nativeReviewDiffAdapter";
import type { PendingReviewComment } from "./pullRequestReviewDrafts";
import { currentInterfaceTranslator } from "../../localization/currentInterfaceTranslator";

function reviewPosition(
  row: NativeReviewDiffRow,
  side: "left" | "right" = "right",
): PullRequestReviewPosition | null {
  if (row.kind !== "line") return null;
  if (row.change === "add" && row.newLineNumber)
    return { kind: "added", newLine: row.newLineNumber };
  if (row.change === "delete" && row.oldLineNumber)
    return { kind: "deleted", oldLine: row.oldLineNumber };
  if (row.oldLineNumber && row.newLineNumber)
    return {
      kind: "context",
      oldLine: row.oldLineNumber,
      newLine: row.newLineNumber,
      side,
    };
  return null;
}
export function buildReviewCommentRange(
  rows: readonly NativeReviewDiffRow[],
  firstId: string,
  lastId: string,
  supportsRange = true,
  requestedSide?: "left" | "right",
) {
  const first = rows.find((row) => row.id === firstId);
  const last = rows.find((row) => row.id === lastId);
  if (
    !first ||
    !last ||
    first.kind !== "line" ||
    last.kind !== "line" ||
    !first.fileId ||
    first.fileId !== last.fileId
  )
    return null;
  if (
    (first.change === "add" && last.change === "delete") ||
    (first.change === "delete" && last.change === "add")
  )
    return null;
  const side =
    requestedSide ?? (first.change === "delete" || last.change === "delete" ? "left" : "right");
  if (
    side === "left"
      ? first.change === "add" || last.change === "add"
      : first.change === "delete" || last.change === "delete"
  )
    return null;
  const start = reviewPosition(first, side);
  const end = reviewPosition(last, side);
  if (!start || !end) return null;
  const lower = Math.min(reviewLine(start), reviewLine(end));
  const upper = Math.max(reviewLine(start), reviewLine(end));
  const selected = rows.filter((row) => {
    if (row.fileId !== first.fileId || row.kind !== "line") return false;
    const line = side === "left" ? row.oldLineNumber : row.newLineNumber;
    return line != null && line >= lower && line <= upper;
  });
  if (selected.length !== upper - lower + 1) return null;
  const startRow = selected[0];
  const endRow = selected.at(-1);
  if (!startRow || !endRow) return null;
  const position = reviewPosition(endRow, side);
  const startPosition =
    supportsRange && selected.length > 1 ? reviewPosition(startRow, side) : null;
  if (!position) return null;
  return {
    position,
    ...(startPosition ? { startPosition } : {}),
    code: (supportsRange ? selected : [endRow]).map((row) => row.content ?? "").join("\n"),
    rowIds: selected.map((row) => row.id),
  };
}
export function discussionCommentCountLabel(count: number) {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
}
export function reviewPositionLabel(
  position: PullRequestReviewPosition,
  startPosition?: PullRequestReviewPosition,
) {
  const oldSide =
    position.kind === "deleted" || (position.kind === "context" && position.side === "left");
  return `${oldSide ? currentInterfaceTranslator().message("mobile.ui.oldLine") : currentInterfaceTranslator().message("mobile.ui.line")} ${startPosition ? `${reviewLine(startPosition)}–` : ""}${reviewLine(position)}`;
}
function reviewLine(position: PullRequestReviewPosition) {
  if (position.kind === "deleted" || (position.kind === "context" && position.side === "left"))
    return position.oldLine;
  return position.newLine;
}
export function annotatePullRequestDiff(
  data: NativeReviewDiffData,
  threads: readonly PullRequestReviewThread[],
  drafts: readonly PendingReviewComment[],
  headSha: string | undefined,
): NativeReviewDiffData {
  if (threads.length === 0 && drafts.length === 0) return data;
  const anchors = new Map<string, NativeReviewDiffRow[]>();
  const firstByPath = new Map<string, NativeReviewDiffRow>();
  const lines = new Map<string, NativeReviewDiffRow>();
  const paths = new Map(data.files.map((file) => [file.id, file.path]));
  for (const original of data.rows) {
    const row = {
      ...original,
      filePath: original.filePath ?? (original.fileId ? paths.get(original.fileId) : undefined),
    };
    if (row.kind === "file" && row.filePath) firstByPath.set(row.filePath, row);
    if (row.kind !== "line" || !row.filePath) continue;
    if (row.oldLineNumber)
      lines.set(JSON.stringify([row.filePath, "left", row.oldLineNumber]), row);
    if (row.newLineNumber)
      lines.set(JSON.stringify([row.filePath, "right", row.newLineNumber]), row);
  }
  const attach = (
    anchor: NativeReviewDiffRow | undefined,
    id: string,
    body: string,
    label: string,
  ) => {
    if (!anchor) return;
    const rows = anchors.get(anchor.id) ?? [];
    rows.push({
      kind: "comment",
      id,
      fileId: anchor.fileId,
      filePath: anchor.filePath,
      commentText: body,
      commentRangeLabel: label,
    });
    anchors.set(anchor.id, rows);
  };
  for (const thread of threads) {
    if (thread.isOutdated) continue;
    const anchor =
      thread.line === null
        ? firstByPath.get(thread.path)
        : lines.get(JSON.stringify([thread.path, thread.side, thread.line]));
    const first = thread.comments[0];
    attach(
      anchor,
      `discussion:${thread.id}`,
      `${first?.author?.login ?? "Discussion"}${thread.isResolved ? " · Resolved" : ""}\n${first?.body ?? ""}\n${discussionCommentCountLabel(thread.commentCount ?? thread.comments.length)} · Tap to open`,
      thread.line === null ? "file" : String(thread.line),
    );
  }
  for (const draft of drafts) {
    if (draft.headSha !== headSha) continue;
    const side =
      draft.position.kind === "deleted"
        ? "left"
        : draft.position.kind === "context"
          ? draft.position.side
          : "right";
    const line = reviewLine(draft.position);
    attach(
      lines.get(JSON.stringify([draft.path, side, line])),
      `draft:${draft.id}`,
      `Pending review · Tap to edit\n${draft.body}`,
      draft.startPosition ? `${reviewLine(draft.startPosition)}–${line}` : String(line),
    );
  }
  return { ...data, rows: data.rows.flatMap((row) => [row, ...(anchors.get(row.id) ?? [])]) };
}
