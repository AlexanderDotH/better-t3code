import * as NodeCrypto from "node:crypto";

export interface GitChangeStats {
  readonly insertions: number;
  readonly deletions: number;
  readonly binary: boolean;
}

export interface GitNumstatEntry extends GitChangeStats {
  readonly path: string;
  readonly oldPath?: string;
}

export type GitChangesDiffSource = "staged" | "unstaged";
export type GitChangeLineType = "context" | "addition" | "deletion" | "no-newline";

export interface GitChangeLine {
  readonly id: string;
  readonly type: GitChangeLineType;
  readonly oldLine?: number;
  readonly newLine?: number;
  readonly content: string;
  readonly selectable: boolean;
  /** Retained only at the trusted server boundary to regenerate a patch. */
  readonly raw: string;
}

export interface GitChangeHunk {
  readonly id: string;
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly header: string;
  readonly lines: ReadonlyArray<GitChangeLine>;
  /** Retained only at the trusted server boundary to regenerate a patch. */
  readonly rawLines: ReadonlyArray<string>;
  readonly headerSuffix: string;
}

export interface ParsedGitChangesDiff {
  readonly path: string;
  readonly source: GitChangesDiffSource;
  readonly patchId: string;
  readonly binary: boolean;
  readonly truncated: boolean;
  readonly hunks: ReadonlyArray<GitChangeHunk>;
  /** Retained only at the trusted server boundary. Never accept this from an RPC client. */
  readonly rawPatch: string;
  readonly rawHeaderLines: ReadonlyArray<string>;
}

export type GitChangeSelection =
  | { readonly kind: "file" }
  | { readonly kind: "hunks"; readonly ids: ReadonlyArray<string> }
  | { readonly kind: "lines"; readonly ids: ReadonlyArray<string> };

export class GitChangeSelectionInvalidError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitChangeSelectionInvalidError";
  }
}

const sha256 = (value: string): string =>
  NodeCrypto.createHash("sha256").update(value).digest("hex");

const parseCount = (value: string): { readonly value: number; readonly binary: boolean } => {
  if (value === "-") return { value: 0, binary: true };
  const parsed = Number.parseInt(value, 10);
  return { value: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0, binary: false };
};

/** Parses `git diff --numstat -z`, including its special three-NUL rename representation. */
export function parseGitNumstatZ(stdout: string): ReadonlyArray<GitNumstatEntry> {
  const entries: Array<GitNumstatEntry> = [];
  let cursor = 0;

  while (cursor < stdout.length) {
    const recordEnd = stdout.indexOf("\0", cursor);
    if (recordEnd < 0) break;
    const record = stdout.slice(cursor, recordEnd);
    cursor = recordEnd + 1;
    if (record.length === 0) continue;

    const firstTab = record.indexOf("\t");
    const secondTab = firstTab < 0 ? -1 : record.indexOf("\t", firstTab + 1);
    if (firstTab < 0 || secondTab < 0) continue;

    const insertions = parseCount(record.slice(0, firstTab));
    const deletions = parseCount(record.slice(firstTab + 1, secondTab));
    const path = record.slice(secondTab + 1);
    const stats = {
      insertions: insertions.value,
      deletions: deletions.value,
      binary: insertions.binary || deletions.binary,
    };

    if (path.length > 0) {
      entries.push({ path, ...stats });
      continue;
    }

    const oldPathEnd = stdout.indexOf("\0", cursor);
    if (oldPathEnd < 0) break;
    const oldPath = stdout.slice(cursor, oldPathEnd);
    cursor = oldPathEnd + 1;
    const newPathEnd = stdout.indexOf("\0", cursor);
    if (newPathEnd < 0) break;
    const newPath = stdout.slice(cursor, newPathEnd);
    cursor = newPathEnd + 1;
    if (newPath.length > 0) entries.push({ path: newPath, oldPath, ...stats });
  }

  return entries;
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

function parseHunk(input: {
  readonly path: string;
  readonly source: GitChangesDiffSource;
  readonly ordinal: number;
  readonly rawLines: ReadonlyArray<string>;
}): GitChangeHunk | null {
  const header = input.rawLines[0] ?? "";
  const match = HUNK_HEADER.exec(header);
  if (!match) return null;

  const oldStart = Number.parseInt(match[1] ?? "0", 10);
  const oldLines = Number.parseInt(match[2] ?? "1", 10);
  const newStart = Number.parseInt(match[3] ?? "0", 10);
  const newLines = Number.parseInt(match[4] ?? "1", 10);
  const headerSuffix = match[5] ?? "";
  const hunkId = sha256(
    [input.source, input.path, String(input.ordinal), header, ...input.rawLines.slice(1)].join(
      "\0",
    ),
  );
  const lines: Array<GitChangeLine> = [];
  let oldLine = oldStart;
  let newLine = newStart;

  input.rawLines.slice(1).forEach((raw, ordinal) => {
    const identity = sha256(`${hunkId}\0${ordinal}\0${raw}`);
    if (raw.startsWith("+")) {
      lines.push({
        id: identity,
        type: "addition",
        newLine,
        content: raw.slice(1),
        selectable: true,
        raw,
      });
      newLine += 1;
      return;
    }
    if (raw.startsWith("-")) {
      lines.push({
        id: identity,
        type: "deletion",
        oldLine,
        content: raw.slice(1),
        selectable: true,
        raw,
      });
      oldLine += 1;
      return;
    }
    if (raw.startsWith(" ")) {
      lines.push({
        id: identity,
        type: "context",
        oldLine,
        newLine,
        content: raw.slice(1),
        selectable: false,
        raw,
      });
      oldLine += 1;
      newLine += 1;
      return;
    }
    if (raw.startsWith("\\ No newline at end of file")) {
      lines.push({
        id: identity,
        type: "no-newline",
        content: raw,
        selectable: false,
        raw,
      });
    }
  });

  return {
    id: hunkId,
    oldStart,
    oldLines,
    newStart,
    newLines,
    header,
    lines,
    rawLines: input.rawLines,
    headerSuffix,
  };
}

export function parseUnifiedChangePatch(input: {
  readonly path: string;
  readonly source: GitChangesDiffSource;
  readonly rawPatch: string;
  readonly truncated: boolean;
  readonly identitySalt?: string;
}): ParsedGitChangesDiff {
  const lines = input.rawPatch.split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  const rawHeaderLines = firstHunk < 0 ? lines : lines.slice(0, firstHunk);
  const hunks: Array<GitChangeHunk> = [];

  if (firstHunk >= 0) {
    let start = firstHunk;
    while (start < lines.length) {
      let end = start + 1;
      while (end < lines.length && !lines[end]?.startsWith("@@ ")) end += 1;
      const rawLines = lines.slice(start, end);
      if (end === lines.length && rawLines.at(-1) === "") rawLines.pop();
      const parsed = parseHunk({
        path: input.path,
        source: input.source,
        ordinal: hunks.length,
        rawLines,
      });
      if (parsed) hunks.push(parsed);
      start = end;
    }
  }

  return {
    path: input.path,
    source: input.source,
    patchId: sha256(`${input.rawPatch}\0${input.identitySalt ?? ""}`),
    binary:
      input.rawPatch.includes("GIT binary patch") ||
      /(?:^|\n)Binary files .+ differ(?:\n|$)/.test(input.rawPatch),
    truncated: input.truncated,
    hunks,
    rawPatch: input.rawPatch,
    rawHeaderLines,
  };
}

const ensureKnownIds = (requested: ReadonlyArray<string>, available: ReadonlySet<string>): void => {
  const missing = requested.find((id) => !available.has(id));
  if (missing) {
    throw new GitChangeSelectionInvalidError(
      `The selected change no longer exists (${missing.slice(0, 12)}).`,
    );
  }
  if (requested.length === 0) {
    throw new GitChangeSelectionInvalidError("At least one change must be selected.");
  }
};

const joinPatchLines = (lines: ReadonlyArray<string>): string => `${lines.join("\n")}\n`;

function buildLineSelectionHunks(
  hunk: GitChangeHunk,
  selected: ReadonlySet<string>,
): ReadonlyArray<string> {
  interface SelectedGroup {
    readonly oldCursor: number;
    readonly newCursor: number;
    readonly lines: Array<string>;
    oldCount: number;
    newCount: number;
  }

  const groups: Array<SelectedGroup> = [];
  let current: SelectedGroup | null = null;
  let oldCursor = hunk.oldStart;
  let newCursor = hunk.newStart;
  let previousWasSelected = false;

  const finishGroup = () => {
    if (!current) return;
    groups.push(current);
    current = null;
  };

  for (const line of hunk.lines) {
    const isSelected = line.selectable && selected.has(line.id);
    if (isSelected) {
      current ??= { oldCursor, newCursor, lines: [], oldCount: 0, newCount: 0 };
      current.lines.push(line.raw);
      if (line.type === "deletion") {
        current.oldCount += 1;
        oldCursor += 1;
      }
      if (line.type === "addition") {
        current.newCount += 1;
        newCursor += 1;
      }
      previousWasSelected = true;
      continue;
    }
    if (line.type === "no-newline" && current && previousWasSelected) {
      current.lines.push(line.raw);
      continue;
    }

    finishGroup();
    previousWasSelected = false;
    if (line.type === "context") {
      oldCursor += 1;
      newCursor += 1;
    }
    if (line.type === "deletion") oldCursor += 1;
    if (line.type === "addition") newCursor += 1;
  }
  finishGroup();

  return groups.flatMap((group) => {
    const oldStart = group.oldCount === 0 ? Math.max(0, group.oldCursor - 1) : group.oldCursor;
    const newStart = group.newCount === 0 ? Math.max(0, group.newCursor - 1) : group.newCursor;
    return [`@@ -${oldStart},${group.oldCount} +${newStart},${group.newCount} @@`, ...group.lines];
  });
}

/**
 * Regenerates a patch exclusively from server-parsed IDs. The RPC boundary must never deserialize
 * `ParsedGitChangesDiff`, because it intentionally retains trusted raw patch material.
 */
export function buildSelectedPatch(
  diff: ParsedGitChangesDiff,
  selection: GitChangeSelection,
): string {
  if (selection.kind === "file") return diff.rawPatch;

  if (selection.kind === "hunks") {
    const available = new Set(diff.hunks.map((hunk) => hunk.id));
    ensureKnownIds(selection.ids, available);
    const selected = new Set(selection.ids);
    if (selected.size === diff.hunks.length) return diff.rawPatch;
    return joinPatchLines([
      ...diff.rawHeaderLines.filter((line) => !line.startsWith("index ")),
      ...diff.hunks.flatMap((hunk) => (selected.has(hunk.id) ? hunk.rawLines : [])),
    ]);
  }

  const available = new Set(
    diff.hunks.flatMap((hunk) =>
      hunk.lines.filter((line) => line.selectable).map((line) => line.id),
    ),
  );
  ensureKnownIds(selection.ids, available);
  const selected = new Set(selection.ids);
  const selectedHunks = diff.hunks.flatMap((hunk) => buildLineSelectionHunks(hunk, selected));
  return joinPatchLines([
    ...diff.rawHeaderLines.filter((line) => !line.startsWith("index ")),
    ...selectedHunks,
  ]);
}
