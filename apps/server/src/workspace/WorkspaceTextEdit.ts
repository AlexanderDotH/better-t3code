import type { WorkspaceEdit } from "@t3tools/contracts";

type WorkspaceTextEditFailureReason =
  | "not_found"
  | "already_exists"
  | "invalid_range"
  | "text_not_found"
  | "ambiguous_match"
  | "expected_count_mismatch";

export type WorkspaceTextEditResult =
  | { readonly ok: true; readonly contents: string | undefined; readonly editCount: number }
  | {
      readonly ok: false;
      readonly reason: WorkspaceTextEditFailureReason;
      readonly editIndex: number;
    };

function countOccurrences(contents: string, search: string): number {
  if (search.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (offset <= contents.length - search.length) {
    const index = contents.indexOf(search, offset);
    if (index < 0) break;
    count += 1;
    offset = index + search.length;
  }
  return count;
}

function lineOffsets(contents: string): ReadonlyArray<number> {
  const offsets = [0];
  for (let index = 0; index < contents.length; index += 1) {
    if (contents[index] === "\n" && index + 1 < contents.length) offsets.push(index + 1);
  }
  return offsets;
}

function applySplice(
  contents: string,
  edit: Extract<WorkspaceEdit, { readonly type: "splice" }>,
): string | undefined {
  if (edit.range.type === "start") return edit.content + contents;
  if (edit.range.type === "end") return contents + edit.content;
  if (edit.range.type === "code_points") {
    const points = Array.from(contents);
    if (edit.range.start > edit.range.end || edit.range.end > points.length) return undefined;
    return [
      ...points.slice(0, edit.range.start),
      edit.content,
      ...points.slice(edit.range.end),
    ].join("");
  }

  const offsets = lineOffsets(contents);
  if (
    edit.range.start > edit.range.end ||
    edit.range.start > offsets.length ||
    edit.range.end > offsets.length
  ) {
    return undefined;
  }
  const start = offsets[edit.range.start - 1] ?? 0;
  const end = offsets[edit.range.end] ?? contents.length;
  return contents.slice(0, start) + edit.content + contents.slice(end);
}

export function applyWorkspaceTextEdits(
  initialContents: string | undefined,
  edits: ReadonlyArray<WorkspaceEdit>,
): WorkspaceTextEditResult {
  let contents = initialContents;
  for (const [editIndex, edit] of edits.entries()) {
    if (edit.type === "write") {
      if (edit.mode === "create" && contents !== undefined) {
        return { ok: false, reason: "already_exists", editIndex };
      }
      if (edit.mode === "overwrite" && contents === undefined) {
        return { ok: false, reason: "not_found", editIndex };
      }
      contents = edit.content;
      continue;
    }

    if (edit.type === "delete") {
      if (contents === undefined && edit.if_missing !== "ignore") {
        return { ok: false, reason: "not_found", editIndex };
      }
      contents = undefined;
      continue;
    }

    if (contents === undefined) return { ok: false, reason: "not_found", editIndex };

    if (edit.type === "splice") {
      const next = applySplice(contents, edit);
      if (next === undefined) return { ok: false, reason: "invalid_range", editIndex };
      contents = next;
      continue;
    }

    const occurrences = countOccurrences(contents, edit.old_text);
    if (occurrences === 0) return { ok: false, reason: "text_not_found", editIndex };
    if (edit.expected_count !== undefined && occurrences !== edit.expected_count) {
      return { ok: false, reason: "expected_count_mismatch", editIndex };
    }
    if ((edit.occurrence ?? "one") === "one" && occurrences !== 1) {
      return { ok: false, reason: "ambiguous_match", editIndex };
    }
    contents =
      edit.occurrence === "all"
        ? contents.replaceAll(edit.old_text, edit.new_text)
        : contents.replace(edit.old_text, edit.new_text);
  }
  return { ok: true, contents, editCount: edits.length };
}
