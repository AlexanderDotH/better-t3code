export interface FileEdit {
  readonly base: string;
  readonly revision: string | null;
  readonly draft: string;
  readonly remote: string;
  readonly remoteRevision: string | null;
  readonly conflict: boolean;
}

export function createFileEdit(file: {
  readonly contents: string;
  readonly revision?: string;
}): FileEdit {
  return {
    base: file.contents,
    draft: file.contents,
    revision: file.revision ?? null,
    remote: file.contents,
    remoteRevision: file.revision ?? null,
    conflict: false,
  };
}

export function reconcileFileEdit(
  edit: FileEdit,
  file: { readonly contents: string; readonly revision?: string },
): FileEdit {
  const revision = file.revision ?? null;
  if (edit.remoteRevision === revision && edit.remote === file.contents) return edit;
  if (edit.draft === edit.base || edit.draft === file.contents) return createFileEdit(file);
  return { ...edit, remote: file.contents, remoteRevision: revision, conflict: true };
}

export function markdownTasks(source: string) {
  const tasks: Array<{
    readonly offset: number;
    readonly checked: boolean;
    readonly label: string;
  }> = [];
  let fence: { readonly marker: string; readonly length: number } | null = null;
  for (const match of source.matchAll(/[^\n]*(?:\n|$)/g)) {
    const line = match[0];
    const delimiter = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[0]!, length: delimiter.length };
      else if (
        delimiter[0] === fence.marker &&
        delimiter.length >= fence.length &&
        /^ {0,3}(?:`+|~+)\s*$/.test(line)
      )
        fence = null;
      continue;
    }
    if (fence) continue;
    const task = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.*)/.exec(line);
    if (task)
      tasks.push({
        offset: match.index + line.indexOf("[") + 1,
        checked: task[1]!.toLowerCase() === "x",
        label: task[2]!.replace(/\r$/, ""),
      });
  }
  return tasks;
}

export function toggleMarkdownTask(source: string, offset: number): string {
  const task = markdownTasks(source).find((candidate) => candidate.offset === offset);
  return task
    ? source.slice(0, offset) + (task.checked ? " " : "x") + source.slice(offset + 1)
    : source;
}
