import type { GitChangesDiffSource } from "@t3tools/contracts";

interface WorkbenchChangeFile {
  readonly path: string;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
}

export interface GitWorkbenchChangeRow<File extends WorkbenchChangeFile = WorkbenchChangeFile> {
  readonly id: string;
  readonly file: File;
  readonly source: GitChangesDiffSource;
}

export function gitWorkbenchChangeRows<File extends WorkbenchChangeFile>(
  snapshot: { readonly files: ReadonlyArray<File> } | null,
): ReadonlyArray<GitWorkbenchChangeRow<File>> {
  if (snapshot === null) return [];
  const rows: Array<GitWorkbenchChangeRow<File>> = [];
  for (const file of snapshot.files) {
    if (file.staged) rows.push({ id: `${file.path}::staged`, file, source: "staged" });
    if (file.unstaged || file.untracked || file.conflicted) {
      rows.push({ id: `${file.path}::unstaged`, file, source: "unstaged" });
    }
  }
  return rows;
}
