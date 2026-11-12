import type { ReviewRenderableRow, ReviewRenderableLineRow } from "./reviewModel";

interface ReviewPreferences {
  readonly diffIgnoreWhitespace: boolean;
  readonly diffFilesCollapsed: boolean;
  readonly diffColorScheme: "red-green" | "blue-orange";
}

export function reviewDiffPreferences(
  preferences: Partial<ReviewPreferences> | undefined,
  defaults: ReviewPreferences,
): ReviewPreferences {
  return {
    diffIgnoreWhitespace: preferences?.diffIgnoreWhitespace ?? defaults.diffIgnoreWhitespace,
    diffFilesCollapsed: preferences?.diffFilesCollapsed ?? defaults.diffFilesCollapsed,
    diffColorScheme: preferences?.diffColorScheme ?? defaults.diffColorScheme,
  };
}

export function reviewTargetSectionId(revision: string | number | undefined): string | null {
  if (revision === undefined) return null;
  const value = String(revision).trim();
  if (/^\d+$/.test(value)) return `turn:${value}`;
  if (/^(turn:\d+|git:(working-tree|branch-range|commit))$/.test(value)) return value;
  if (/^[a-f\d]{40,64}$/i.test(value)) return "git:commit";
  if (value === "working-tree" || value === "branch-range") return `git:${value}`;
  return null;
}

export function splitReviewRows(rows: ReadonlyArray<ReviewRenderableRow>) {
  const result: Array<{
    readonly id: string;
    readonly header?: string;
    readonly left: ReviewRenderableLineRow | null;
    readonly right: ReviewRenderableLineRow | null;
  }> = [];
  for (let index = 0; index < rows.length;) {
    const row = rows[index]!;
    if (row.kind === "hunk") {
      result.push({ id: row.id, header: row.header, left: null, right: null });
      index++;
      continue;
    }
    if (row.change === "context") {
      result.push({ id: row.id, left: row, right: row });
      index++;
      continue;
    }
    const removed: ReviewRenderableLineRow[] = [];
    const added: ReviewRenderableLineRow[] = [];
    while (index < rows.length) {
      const next = rows[index]!;
      if (next.kind !== "line" || next.change !== "delete") break;
      removed.push(next);
      index++;
    }
    while (index < rows.length) {
      const next = rows[index]!;
      if (next.kind !== "line" || next.change !== "add") break;
      added.push(next);
      index++;
    }
    for (let position = 0; position < Math.max(removed.length, added.length); position++) {
      const left = removed[position] ?? null;
      const right = added[position] ?? null;
      result.push({ id: `${left?.id ?? ""}:${right?.id ?? ""}`, left, right });
    }
  }
  return result;
}

export function filterWhitespaceRows(
  rows: ReadonlyArray<ReviewRenderableRow>,
  ignore: boolean,
): ReadonlyArray<ReviewRenderableRow> {
  if (!ignore) return rows;
  const hidden = new Set<string>();
  for (const pair of splitReviewRows(rows)) {
    if (pair.left?.change !== "delete" || pair.right?.change !== "add") continue;
    if (pair.left.content.replace(/\s+/g, "") === pair.right.content.replace(/\s+/g, "")) {
      hidden.add(pair.left.id);
      hidden.add(pair.right.id);
    }
  }
  return rows.filter((row) => !hidden.has(row.id));
}
