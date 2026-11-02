import { proposedPlanTitle, stripDisplayedPlanMarkdown } from "@t3tools/shared/proposedPlanText";

export function buildCollapsedProposedPlanPreviewMarkdown(
  planMarkdown: string,
  options?: { readonly maxLines?: number },
): string {
  const maxLines = options?.maxLines ?? 8;
  const lines = stripDisplayedPlanMarkdown(planMarkdown)
    .trimEnd()
    .split(/\r?\n/)
    .map((line) => line.trimEnd());
  const previewLines: string[] = [];
  let visibleLineCount = 0;
  let hasMoreContent = false;
  for (const line of lines) {
    const isVisibleLine = line.trim().length > 0;
    if (isVisibleLine && visibleLineCount >= maxLines) {
      hasMoreContent = true;
      break;
    }
    previewLines.push(line);
    if (isVisibleLine) visibleLineCount += 1;
  }
  while (previewLines.length > 0 && previewLines.at(-1)?.trim().length === 0) previewLines.pop();
  if (previewLines.length === 0)
    return proposedPlanTitle(planMarkdown) ?? "Plan preview unavailable.";
  if (hasMoreContent) previewLines.push("", "...");
  return previewLines.join("\n");
}

export function normalizePlanMarkdownForExport(planMarkdown: string): string {
  return `${planMarkdown.trimEnd()}\n`;
}
