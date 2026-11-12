import type { OrchestrationV2TurnItem } from "@t3tools/contracts";
import { quoteGitPatchPath } from "@t3tools/shared/gitPatchPath";
import { createTwoFilesPatch } from "diff";

type FileChange = Extract<OrchestrationV2TurnItem, { type: "file_change" }>;

export function toolItemDiff(
  item: Pick<FileChange, "fileName" | "changes" | "diffStr" | "oldStr" | "newStr">,
) {
  const change = item.changes?.[0];
  const before =
    change?.operation === "add" ? "/dev/null" : `a/${change?.oldPath ?? item.fileName}`;
  const after = change?.operation === "delete" ? "/dev/null" : `b/${change?.path ?? item.fileName}`;
  const suffix = "\n… output truncated for transport";
  const source = item.diffStr?.endsWith(suffix)
    ? item.diffStr.slice(0, -suffix.length)
    : item.diffStr;
  if (source?.startsWith("diff --git ") || source?.startsWith("--- ")) return source;
  if (source?.trimStart().startsWith("@@ "))
    return `diff --git ${quoteGitPatchPath(before)} ${quoteGitPatchPath(after)}\n--- ${quoteGitPatchPath(before)}\n+++ ${quoteGitPatchPath(after)}\n${source.trimStart()}`;
  if (source !== undefined && (change?.operation === "add" || change?.operation === "delete"))
    return createTwoFilesPatch(
      before,
      after,
      change.operation === "add" ? "" : source,
      change.operation === "delete" ? "" : source,
    );
  if (item.oldStr !== undefined || item.newStr !== undefined)
    return createTwoFilesPatch(before, after, item.oldStr ?? "", item.newStr ?? "");
  return source ?? null;
}
