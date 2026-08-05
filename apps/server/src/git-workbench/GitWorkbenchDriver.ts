import * as NodeCrypto from "node:crypto";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Semaphore from "effect/Semaphore";

import type {
  GitChangesDiffResult as ContractGitChangesDiff,
  GitDiffHunk as ContractGitDiffHunk,
  GitDiffLine as ContractGitDiffLine,
  GitWorkbenchFile as ContractGitWorkbenchFile,
  GitWorkbenchFileKind as ContractGitWorkbenchFileKind,
  GitWorkbenchFileStatus as ContractGitWorkbenchFileStatus,
  GitWorkbenchOperationKind as ContractGitWorkbenchOperationKind,
  GitWorkbenchOperationState as ContractGitWorkbenchOperation,
  GitWorkbenchSnapshot as ContractGitWorkbenchSnapshot,
  VcsError,
} from "@t3tools/contracts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import {
  buildSelectedPatch,
  GitChangeSelectionInvalidError,
  type GitChangeSelection,
  type GitChangeStats,
  type GitChangesDiffSource,
  parseGitNumstatZ,
  type ParsedGitChangesDiff,
  parseUnifiedChangePatch,
} from "./GitChangeDiff.ts";

const STATUS_MAX_OUTPUT_BYTES = 2_000_000;
const DIFF_MAX_OUTPUT_BYTES = 2_000_000;
const MAX_STATUS_FILES = 10_000;
const MAX_CONTENT_HASH_PATHS = 512;
const CONTENT_HASH_CHUNK_SIZE = 128;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const GIT_ENV = Object.freeze({
  GIT_EXTERNAL_DIFF: "",
  GIT_LITERAL_PATHSPECS: "1",
  GIT_PAGER: "cat",
  LC_ALL: "C",
} satisfies NodeJS.ProcessEnv);

const REGISTERED_WORKSPACE = Symbol("RegisteredGitWorkspace");

/**
 * An RPC handler may create this value only after resolving `cwd` through the authenticated project
 * registry. Keeping it distinct prevents lower layers from accidentally accepting a client path.
 */
export interface RegisteredGitWorkspace {
  readonly cwd: string;
  readonly [REGISTERED_WORKSPACE]: true;
}

export function makeRegisteredGitWorkspace(registeredCwd: string): RegisteredGitWorkspace {
  const looksAbsolute =
    registeredCwd.startsWith("/") ||
    registeredCwd.startsWith("\\\\") ||
    /^[A-Za-z]:[\\/]/.test(registeredCwd);
  if (!looksAbsolute || registeredCwd.includes("\0")) {
    throw new TypeError("A registered Git workspace path must be absolute and contain no NUL.");
  }
  return Object.freeze({
    cwd: registeredCwd,
    [REGISTERED_WORKSPACE]: true as const,
  });
}

export class GitWorkbenchInvalidPathError extends Data.TaggedError("GitWorkbenchInvalidPathError")<{
  readonly path: string;
  readonly reason: string;
}> {}

export class GitWorkbenchNotRepositoryError extends Data.TaggedError(
  "GitWorkbenchNotRepositoryError",
)<{
  readonly cwd: string;
}> {}

export class GitWorkbenchStaleStateError extends Data.TaggedError("GitWorkbenchStaleStateError")<{
  readonly expectedStateToken: string;
  readonly actualStateToken: string;
  readonly reason: "repository_changed" | "patch_changed";
}> {}

export class GitChangeSelectionRestrictedError extends Data.TaggedError(
  "GitChangeSelectionRestrictedError",
)<{
  readonly path: string;
  readonly restriction:
    | "unsupported_selection"
    | "binary_selection"
    | "conflicted_selection"
    | "destructive_confirmation_required";
  readonly reason: string;
}> {}

export type GitWorkbenchDriverDomainError =
  | GitWorkbenchInvalidPathError
  | GitWorkbenchNotRepositoryError
  | GitWorkbenchStaleStateError
  | GitChangeSelectionRestrictedError;

export type GitWorkbenchFileKind = ContractGitWorkbenchFileKind;
export type GitWorkbenchFileStatus = ContractGitWorkbenchFileStatus;
export type GitWorkbenchFile = ContractGitWorkbenchFile;
export type GitWorkbenchOperationKind = ContractGitWorkbenchOperationKind;
export type GitWorkbenchOperation = ContractGitWorkbenchOperation;
export type GitWorkbenchSnapshot = ContractGitWorkbenchSnapshot;
export type GitChangesDiffLine = ContractGitDiffLine;
export type GitChangesDiffHunk = ContractGitDiffHunk;
export type GitChangesDiff = ContractGitChangesDiff;

export interface GitApplyChangeSelectionInput {
  readonly workspace: RegisteredGitWorkspace;
  readonly path: string;
  readonly source: GitChangesDiffSource;
  readonly action: "stage" | "unstage" | "discard";
  readonly selection: GitChangeSelection;
  readonly expectedStateToken: string;
  readonly expectedPatchId: string;
  readonly confirmedUntrackedDeletion?: boolean;
}

interface ParsedPorcelainFile {
  readonly path: string;
  readonly oldPath?: string;
  readonly kind: GitWorkbenchFileKind;
  readonly indexStatus: GitWorkbenchFileStatus;
  readonly worktreeStatus: GitWorkbenchFileStatus;
  readonly staged: boolean;
  readonly unstaged: boolean;
  readonly untracked: boolean;
  readonly conflicted: boolean;
  readonly submodule: boolean;
  readonly modeChanged: boolean;
}

interface ParsedPorcelainBranch {
  readonly headOid: string | null;
  readonly refName: string | null;
  readonly upstreamRef: string | null;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly detached: boolean;
  readonly unborn: boolean;
}

export interface ParsedPorcelainV2 {
  readonly branch: ParsedPorcelainBranch;
  readonly files: ReadonlyArray<ParsedPorcelainFile>;
}

const EMPTY_STATS = Object.freeze({
  insertions: 0,
  deletions: 0,
  binary: false,
} satisfies GitChangeStats);

const EMPTY_BRANCH: ParsedPorcelainBranch = Object.freeze({
  headOid: null,
  refName: null,
  upstreamRef: null,
  aheadCount: 0,
  behindCount: 0,
  detached: false,
  unborn: true,
});

function takeFields(
  record: string,
  count: number,
): { readonly fields: ReadonlyArray<string>; readonly remainder: string } | null {
  const fields: Array<string> = [];
  let cursor = 0;
  for (let index = 0; index < count; index += 1) {
    const separator = record.indexOf(" ", cursor);
    if (separator < 0) return null;
    fields.push(record.slice(cursor, separator));
    cursor = separator + 1;
  }
  return { fields, remainder: record.slice(cursor) };
}

function kindFromStatus(
  indexStatus: string,
  worktreeStatus: string,
  fallback: GitWorkbenchFileKind = "unknown",
): GitWorkbenchFileKind {
  const combined = `${indexStatus}${worktreeStatus}`;
  if (combined.includes("U") || combined === "AA" || combined === "DD") return "conflicted";
  if (combined.includes("R")) return "renamed";
  if (combined.includes("C")) return "copied";
  if (combined.includes("A")) return "added";
  if (combined.includes("D")) return "deleted";
  if (combined.includes("T")) return "type-changed";
  if (combined.includes("M")) return "modified";
  return fallback;
}

function fileStatusFromCode(code: string, conflicted: boolean): GitWorkbenchFileStatus {
  if (conflicted) return "conflicted";
  switch (code) {
    case ".":
      return "unmodified";
    case "M":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "conflicted";
    default:
      return "unknown";
  }
}

function parseTrackedRecord(
  record: string,
  type: "1" | "2" | "u",
  oldPath?: string,
): ParsedPorcelainFile | null {
  const fieldCount = type === "1" ? 8 : type === "2" ? 9 : 10;
  const parsed = takeFields(record, fieldCount);
  if (!parsed || parsed.remainder.length === 0) return null;
  const indexCode = parsed.fields[1]?.charAt(0) || ".";
  const worktreeCode = parsed.fields[1]?.charAt(1) || ".";
  const submoduleField = parsed.fields[2] ?? "N...";
  const modeFields = (type === "u" ? parsed.fields.slice(3, 7) : parsed.fields.slice(3, 6)).filter(
    (mode) => mode !== "000000",
  );
  const conflicted = type === "u";

  return {
    path: parsed.remainder,
    ...(oldPath !== undefined ? { oldPath } : {}),
    kind: conflicted ? "conflicted" : kindFromStatus(indexCode, worktreeCode),
    indexStatus: fileStatusFromCode(indexCode, conflicted),
    worktreeStatus: fileStatusFromCode(worktreeCode, conflicted),
    staged: conflicted || indexCode !== ".",
    unstaged: conflicted || worktreeCode !== ".",
    untracked: false,
    conflicted,
    submodule: submoduleField !== "N...",
    modeChanged: new Set(modeFields).size > 1,
  };
}

/** Parses `git status --porcelain=v2 --branch -z` without splitting records on whitespace. */
export function parsePorcelainV2(stdout: string): ParsedPorcelainV2 {
  const records = stdout.split("\0");
  if (records.at(-1) !== "") records.pop();
  const files: Array<ParsedPorcelainFile> = [];
  const branch: ParsedPorcelainBranch = { ...EMPTY_BRANCH };

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index] ?? "";
    if (record.startsWith("# branch.oid ")) {
      const oid = record.slice("# branch.oid ".length);
      Object.assign(branch, {
        headOid: oid === "(initial)" ? null : oid,
        unborn: oid === "(initial)",
      });
      continue;
    }
    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length);
      Object.assign(branch, {
        refName: head === "(detached)" ? null : head,
        detached: head === "(detached)",
      });
      continue;
    }
    if (record.startsWith("# branch.upstream ")) {
      Object.assign(branch, { upstreamRef: record.slice("# branch.upstream ".length) });
      continue;
    }
    if (record.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record);
      if (match) {
        Object.assign(branch, {
          aheadCount: Number.parseInt(match[1] ?? "0", 10),
          behindCount: Number.parseInt(match[2] ?? "0", 10),
        });
      }
      continue;
    }
    if (record.startsWith("? ")) {
      files.push({
        path: record.slice(2),
        kind: "untracked",
        indexStatus: "untracked",
        worktreeStatus: "untracked",
        staged: false,
        unstaged: false,
        untracked: true,
        conflicted: false,
        submodule: false,
        modeChanged: false,
      });
      continue;
    }
    if (record.startsWith("2 ")) {
      const oldPath = records[index + 1];
      const file = parseTrackedRecord(record, "2", oldPath);
      if (file) files.push(file);
      if (oldPath !== undefined) index += 1;
      continue;
    }
    if (record.startsWith("1 ")) {
      const file = parseTrackedRecord(record, "1");
      if (file) files.push(file);
      continue;
    }
    if (record.startsWith("u ")) {
      const file = parseTrackedRecord(record, "u");
      if (file) files.push(file);
    }
  }

  return { branch, files };
}

const trimSingleLine = (value: string): string => value.replace(/[\r\n]+$/, "");

function statsByPath(stdout: string): ReadonlyMap<string, GitChangeStats> {
  const result = new Map<string, GitChangeStats>();
  for (const entry of parseGitNumstatZ(stdout)) {
    result.set(entry.path, {
      insertions: entry.insertions,
      deletions: entry.deletions,
      binary: entry.binary,
    });
  }
  return result;
}

function toWorkbenchFiles(
  parsed: ReadonlyArray<ParsedPorcelainFile>,
  stagedStats: ReadonlyMap<string, GitChangeStats>,
  unstagedStats: ReadonlyMap<string, GitChangeStats>,
): ReadonlyArray<GitWorkbenchFile> {
  return parsed.slice(0, MAX_STATUS_FILES).map((file) => {
    const staged = stagedStats.get(file.path) ?? EMPTY_STATS;
    const unstaged = unstagedStats.get(file.path) ?? EMPTY_STATS;
    return {
      ...file,
      binary: staged.binary || unstaged.binary,
      stagedStats: staged,
      unstagedStats: unstaged,
    };
  });
}

function totalFiles(files: ReadonlyArray<GitWorkbenchFile>): GitWorkbenchSnapshot["totals"] {
  return files.reduce(
    (totals, file) => ({
      staged: totals.staged + Number(file.staged),
      unstaged: totals.unstaged + Number(file.unstaged),
      untracked: totals.untracked + Number(file.untracked),
      conflicted: totals.conflicted + Number(file.conflicted),
      insertions: totals.insertions + file.stagedStats.insertions + file.unstagedStats.insertions,
      deletions: totals.deletions + file.stagedStats.deletions + file.unstagedStats.deletions,
    }),
    { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, insertions: 0, deletions: 0 },
  );
}

const hashToken = (parts: ReadonlyArray<string>): string => {
  const hash = NodeCrypto.createHash("sha256");
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
};

function parseLastCommit(stdout: string): NonNullable<GitWorkbenchSnapshot["lastCommit"]> | null {
  const [oid = "", shortOid = "", rawSubject = "", committedAt = ""] = stdout.trimEnd().split("\0");
  const parsedCommittedAt = DateTime.make(committedAt);
  if (
    !GIT_OBJECT_ID_PATTERN.test(oid) ||
    !/^[0-9a-f]{4,64}$/.test(shortOid) ||
    Option.isNone(parsedCommittedAt)
  ) {
    return null;
  }
  return {
    oid,
    shortOid,
    subject: rawSubject.trim() || "(no subject)",
    committedAt: DateTime.formatIso(parsedCommittedAt.value),
  };
}

function nonRepositorySnapshot(
  cwd: string,
  diagnostic: string,
  generatedAt: string,
): GitWorkbenchSnapshot {
  const stateToken = hashToken(["not-repository", cwd, diagnostic]);
  return {
    isRepository: false,
    registeredCwd: cwd,
    repositoryRoot: null,
    worktreeRoot: null,
    gitCommonDir: null,
    refName: null,
    upstreamRef: null,
    upstreamOid: null,
    headOid: null,
    unborn: false,
    detached: false,
    aheadCount: 0,
    behindCount: 0,
    files: [],
    totals: { staged: 0, unstaged: 0, untracked: 0, conflicted: 0, insertions: 0, deletions: 0 },
    operation: { kind: "none" },
    truncated: false,
    generatedAt,
    indexStateToken: stateToken,
    worktreeStateToken: stateToken,
    stateToken,
  };
}

function safeDiff(
  diff: ParsedGitChangesDiff,
  stateToken: string,
  oldPath?: string,
  binary = false,
): GitChangesDiff {
  return {
    path: diff.path,
    ...(oldPath !== undefined ? { oldPath } : {}),
    source: diff.source,
    stateToken,
    patchId: diff.patchId,
    binary: diff.binary || binary,
    truncated: diff.truncated,
    hunks: diff.hunks.map((hunk) => ({
      id: hunk.id,
      oldStart: hunk.oldStart,
      oldLines: hunk.oldLines,
      newStart: hunk.newStart,
      newLines: hunk.newLines,
      header: hunk.header,
      lines: hunk.lines.map((line) => ({
        id: line.id,
        type: line.type,
        ...(line.oldLine !== undefined ? { oldLine: line.oldLine } : {}),
        ...(line.newLine !== undefined ? { newLine: line.newLine } : {}),
        content: line.content,
        selectable: line.selectable,
      })),
    })),
  };
}

export interface GitWorkbenchDriverService {
  readonly getSnapshot: (
    workspace: RegisteredGitWorkspace,
  ) => Effect.Effect<GitWorkbenchSnapshot, VcsError>;
  readonly getChangesDiff: (input: {
    readonly workspace: RegisteredGitWorkspace;
    readonly path: string;
    readonly source: GitChangesDiffSource;
    readonly expectedStateToken?: string;
  }) => Effect.Effect<GitChangesDiff, VcsError | GitWorkbenchDriverDomainError>;
  readonly applyChangeSelection: (
    input: GitApplyChangeSelectionInput,
  ) => Effect.Effect<GitWorkbenchSnapshot, VcsError | GitWorkbenchDriverDomainError>;
}

export class GitWorkbenchDriver extends Context.Service<
  GitWorkbenchDriver,
  GitWorkbenchDriverService
>()("t3/git-workbench/GitWorkbenchDriver") {}

export const make = Effect.gen(function* () {
  const process = yield* VcsProcess.VcsProcess;
  const fileSystem = yield* FileSystem.FileSystem;
  const pathService = yield* Path.Path;
  const worktreeLocks = new Map<string, Semaphore.Semaphore>();

  const validateGitPath = (path: string): Effect.Effect<string, GitWorkbenchInvalidPathError> => {
    if (path.length === 0) {
      return Effect.fail(new GitWorkbenchInvalidPathError({ path, reason: "Path is empty." }));
    }
    if (path.includes("\0")) {
      return Effect.fail(new GitWorkbenchInvalidPathError({ path, reason: "Path contains NUL." }));
    }
    if (pathService.isAbsolute(path)) {
      return Effect.fail(new GitWorkbenchInvalidPathError({ path, reason: "Path is absolute." }));
    }
    const separators = pathService.sep === "\\" ? /[\\/]/ : /\//;
    if (
      path
        .split(separators)
        .some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      return Effect.fail(
        new GitWorkbenchInvalidPathError({
          path,
          reason: "Path is not a literal repository path.",
        }),
      );
    }
    return Effect.succeed(path);
  };

  const resolveGitPath = (cwd: string, value: string): string => {
    const path = trimSingleLine(value);
    return pathService.isAbsolute(path)
      ? pathService.normalize(path)
      : pathService.resolve(cwd, path);
  };

  const exists = (path: string): Effect.Effect<boolean> =>
    fileSystem.exists(path).pipe(Effect.orElseSucceed(() => false));

  const readPositiveInteger = (path: string): Effect.Effect<number | undefined> =>
    fileSystem.readFileString(path).pipe(
      Effect.map((value) => {
        const parsed = Number.parseInt(value.slice(0, 64).trim(), 10);
        return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
      }),
      Effect.orElseSucceed(() => undefined),
    );

  const readOperationRef = (path: string): Effect.Effect<string | undefined> =>
    fileSystem.readFileString(path).pipe(
      Effect.map((value) => {
        const ref = value.slice(0, 1_025).trim();
        return ref.length > 0 && ref.length <= 1_024 && !ref.includes("\0") ? ref : undefined;
      }),
      Effect.orElseSucceed(() => undefined),
    );

  const readOperationOid = (path: string): Effect.Effect<string | undefined> =>
    fileSystem.readFileString(path).pipe(
      Effect.map((value) => {
        const oid = value.slice(0, 65).trim();
        return GIT_OBJECT_ID_PATTERN.test(oid) ? oid : undefined;
      }),
      Effect.orElseSucceed(() => undefined),
    );

  const detectOperation = Effect.fn("GitWorkbenchDriver.detectOperation")(function* (
    gitDir: string,
  ) {
    const rebaseMerge = pathService.join(gitDir, "rebase-merge");
    if (yield* exists(rebaseMerge)) {
      const currentStep = yield* readPositiveInteger(pathService.join(rebaseMerge, "msgnum"));
      const totalSteps = yield* readPositiveInteger(pathService.join(rebaseMerge, "end"));
      const headName = yield* readOperationRef(pathService.join(rebaseMerge, "head-name"));
      const ontoOid = yield* readOperationOid(pathService.join(rebaseMerge, "onto"));
      return {
        kind: "rebase",
        ...(currentStep !== undefined ? { currentStep } : {}),
        ...(totalSteps !== undefined ? { totalSteps } : {}),
        ...(headName !== undefined ? { headName } : {}),
        ...(ontoOid !== undefined ? { ontoOid } : {}),
      } satisfies GitWorkbenchOperation;
    }

    const rebaseApply = pathService.join(gitDir, "rebase-apply");
    if (yield* exists(rebaseApply)) {
      const currentStep = yield* readPositiveInteger(pathService.join(rebaseApply, "next"));
      const totalSteps = yield* readPositiveInteger(pathService.join(rebaseApply, "last"));
      const applying = yield* exists(pathService.join(rebaseApply, "applying"));
      const headName = yield* readOperationRef(pathService.join(rebaseApply, "head-name"));
      const ontoOid = yield* readOperationOid(pathService.join(rebaseApply, "onto"));
      return {
        kind: applying ? "apply-mailbox" : "rebase",
        ...(currentStep !== undefined ? { currentStep } : {}),
        ...(totalSteps !== undefined ? { totalSteps } : {}),
        ...(headName !== undefined ? { headName } : {}),
        ...(ontoOid !== undefined ? { ontoOid } : {}),
      } satisfies GitWorkbenchOperation;
    }
    if (yield* exists(pathService.join(gitDir, "CHERRY_PICK_HEAD"))) {
      return { kind: "cherry-pick" } satisfies GitWorkbenchOperation;
    }
    if (yield* exists(pathService.join(gitDir, "REVERT_HEAD"))) {
      return { kind: "revert" } satisfies GitWorkbenchOperation;
    }
    if (yield* exists(pathService.join(gitDir, "MERGE_HEAD"))) {
      return { kind: "merge" } satisfies GitWorkbenchOperation;
    }
    if (yield* exists(pathService.join(gitDir, "BISECT_LOG"))) {
      return { kind: "bisect" } satisfies GitWorkbenchOperation;
    }
    return { kind: "none" } satisfies GitWorkbenchOperation;
  });

  const lockFor = (cwd: string): Semaphore.Semaphore => {
    const existing = worktreeLocks.get(cwd);
    if (existing) return existing;
    const created = Semaphore.makeUnsafe(1);
    worktreeLocks.set(cwd, created);
    return created;
  };

  const runGit = (
    workspace: RegisteredGitWorkspace,
    operation: string,
    args: ReadonlyArray<string>,
    options?: {
      readonly stdin?: string;
      readonly allowNonZeroExit?: boolean;
      readonly maxOutputBytes?: number;
    },
  ) =>
    process.run({
      operation,
      command: "git",
      args: ["-C", workspace.cwd, ...args],
      cwd: workspace.cwd,
      spawnCwd: globalThis.process.cwd(),
      env: GIT_ENV,
      timeoutMs: 30_000,
      maxOutputBytes: options?.maxOutputBytes ?? DIFF_MAX_OUTPUT_BYTES,
      ...(options?.stdin !== undefined ? { stdin: options.stdin } : {}),
      ...(options?.allowNonZeroExit !== undefined
        ? { allowNonZeroExit: options.allowNonZeroExit }
        : {}),
    });

  const hashWorktreeContent = Effect.fn("GitWorkbenchDriver.hashWorktreeContent")(function* (
    workspace: RegisteredGitWorkspace,
    files: ReadonlyArray<ParsedPorcelainFile>,
  ) {
    const paths = files
      .filter((file) => (file.unstaged || file.untracked) && file.kind !== "deleted")
      .map((file) => file.path)
      .slice(0, MAX_CONTENT_HASH_PATHS);
    const chunks: Array<string> = [];
    for (let index = 0; index < paths.length; index += CONTENT_HASH_CHUNK_SIZE) {
      const chunk = paths.slice(index, index + CONTENT_HASH_CHUNK_SIZE);
      const result = yield* runGit(
        workspace,
        "GitWorkbenchDriver.snapshot.hashWorktree",
        ["hash-object", "--no-filters", "--", ...chunk],
        { allowNonZeroExit: true, maxOutputBytes: 128_000 },
      );
      chunks.push(String(result.exitCode), result.stdout, result.stderr);
    }
    return chunks.join("\0");
  });

  const getSnapshotUnlocked = Effect.fn("GitWorkbenchDriver.getSnapshotUnlocked")(function* (
    workspace: RegisteredGitWorkspace,
  ) {
    const status = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.status",
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
      { allowNonZeroExit: true, maxOutputBytes: STATUS_MAX_OUTPUT_BYTES },
    );
    if (status.exitCode !== 0) {
      const now = yield* DateTime.now;
      return nonRepositorySnapshot(workspace.cwd, status.stderr, DateTime.formatIso(now));
    }

    const parsed = parsePorcelainV2(status.stdout);
    const topLevel = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.topLevel",
      ["rev-parse", "--path-format=absolute", "--show-toplevel"],
      { maxOutputBytes: 16_384 },
    );
    const gitDirResult = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.gitDir",
      ["rev-parse", "--path-format=absolute", "--absolute-git-dir"],
      { maxOutputBytes: 16_384 },
    );
    const commonDirResult = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.commonDir",
      ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { maxOutputBytes: 16_384 },
    );
    const stagedStatsResult = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.stagedStats",
      ["diff", "--cached", "--numstat", "-z", "--no-ext-diff", "--no-textconv"],
      { maxOutputBytes: STATUS_MAX_OUTPUT_BYTES },
    );
    const unstagedStatsResult = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.unstagedStats",
      ["diff", "--numstat", "-z", "--no-ext-diff", "--no-textconv"],
      { maxOutputBytes: STATUS_MAX_OUTPUT_BYTES },
    );
    const stagedIdentity = yield* runGit(
      workspace,
      "GitWorkbenchDriver.snapshot.stagedIdentity",
      ["diff", "--cached", "--raw", "-z", "--full-index", "--no-ext-diff", "--no-textconv"],
      { maxOutputBytes: STATUS_MAX_OUTPUT_BYTES },
    );
    const worktreeContentIdentity = yield* hashWorktreeContent(workspace, parsed.files);
    const lastCommitResult = parsed.branch.headOid
      ? yield* runGit(
          workspace,
          "GitWorkbenchDriver.snapshot.lastCommit",
          ["log", "-1", "--format=%H%x00%h%x00%s%x00%cI", "HEAD"],
          { allowNonZeroExit: true, maxOutputBytes: 16_384 },
        )
      : null;
    const lastCommit =
      lastCommitResult?.exitCode === 0 ? parseLastCommit(lastCommitResult.stdout) : null;
    const upstreamOidResult = parsed.branch.upstreamRef
      ? yield* runGit(
          workspace,
          "GitWorkbenchDriver.snapshot.upstreamOid",
          ["rev-parse", "--verify", `${parsed.branch.upstreamRef}^{}`],
          { allowNonZeroExit: true, maxOutputBytes: 1_024 },
        )
      : null;
    const upstreamOidCandidate = upstreamOidResult?.stdout.trim() ?? "";
    const upstreamOid = GIT_OBJECT_ID_PATTERN.test(upstreamOidCandidate)
      ? upstreamOidCandidate
      : null;

    const repositoryRoot = resolveGitPath(workspace.cwd, topLevel.stdout);
    const gitDir = resolveGitPath(workspace.cwd, gitDirResult.stdout);
    const gitCommonDir = resolveGitPath(workspace.cwd, commonDirResult.stdout);
    const files = toWorkbenchFiles(
      parsed.files,
      statsByPath(stagedStatsResult.stdout),
      statsByPath(unstagedStatsResult.stdout),
    );
    const detectedOperation = yield* detectOperation(gitDir);
    const conflictingPaths = files.filter((file) => file.conflicted).map((file) => file.path);
    const operation: GitWorkbenchOperation = {
      ...detectedOperation,
      ...(conflictingPaths.length > 0 ? { conflictingPaths } : {}),
    };
    const truncated =
      status.stdoutTruncated ||
      stagedStatsResult.stdoutTruncated ||
      unstagedStatsResult.stdoutTruncated ||
      stagedIdentity.stdoutTruncated ||
      parsed.files.length > MAX_STATUS_FILES ||
      parsed.files.filter((file) => file.unstaged || file.untracked).length >
        MAX_CONTENT_HASH_PATHS;
    const indexStateToken = hashToken([
      parsed.branch.headOid ?? "unborn",
      stagedIdentity.stdout,
      stagedIdentity.stdoutTruncated ? "truncated" : "complete",
    ]);
    const worktreeStateToken = hashToken([
      status.stdout,
      unstagedStatsResult.stdout,
      worktreeContentIdentity,
      truncated ? "truncated" : "complete",
    ]);
    const stateToken = hashToken([
      indexStateToken,
      worktreeStateToken,
      upstreamOid ?? "",
      operation.kind,
      operation.headName ?? "",
      operation.ontoOid ?? "",
      String(operation.currentStep ?? ""),
      String(operation.totalSteps ?? ""),
      ...(operation.conflictingPaths ?? []),
      repositoryRoot,
      gitCommonDir,
      truncated ? "truncated" : "complete",
    ]);

    const now = yield* DateTime.now;
    return {
      isRepository: true,
      registeredCwd: workspace.cwd,
      repositoryRoot,
      worktreeRoot: repositoryRoot,
      gitCommonDir,
      refName: parsed.branch.refName,
      upstreamRef: parsed.branch.upstreamRef,
      upstreamOid,
      headOid: parsed.branch.headOid,
      unborn: parsed.branch.unborn,
      detached: parsed.branch.detached,
      aheadCount: parsed.branch.aheadCount,
      behindCount: parsed.branch.behindCount,
      lastCommit,
      files,
      totals: totalFiles(files),
      operation,
      truncated,
      generatedAt: DateTime.formatIso(now),
      indexStateToken,
      worktreeStateToken,
      stateToken,
    } satisfies GitWorkbenchSnapshot;
  });

  const assertRepository = (
    snapshot: GitWorkbenchSnapshot,
  ): Effect.Effect<GitWorkbenchSnapshot, GitWorkbenchNotRepositoryError> =>
    snapshot.isRepository
      ? Effect.succeed(snapshot)
      : Effect.fail(new GitWorkbenchNotRepositoryError({ cwd: snapshot.registeredCwd }));

  const assertStateToken = (
    snapshot: GitWorkbenchSnapshot,
    expectedStateToken?: string,
  ): Effect.Effect<void, GitWorkbenchStaleStateError> => {
    if (expectedStateToken === undefined || expectedStateToken === snapshot.stateToken) {
      return Effect.void;
    }
    return Effect.fail(
      new GitWorkbenchStaleStateError({
        expectedStateToken,
        actualStateToken: snapshot.stateToken,
        reason: "repository_changed",
      }),
    );
  };

  const findChange = (
    snapshot: GitWorkbenchSnapshot,
    path: string,
    source: GitChangesDiffSource,
  ): Effect.Effect<GitWorkbenchFile, GitChangeSelectionRestrictedError> => {
    const file = snapshot.files.find((entry) => entry.path === path);
    const available = source === "staged" ? file?.staged : file?.unstaged || file?.untracked;
    if (file && available) return Effect.succeed(file);
    return Effect.fail(
      new GitChangeSelectionRestrictedError({
        path,
        restriction: "unsupported_selection",
        reason: `No ${source} change exists for this path.`,
      }),
    );
  };

  const getParsedChangesDiffUnlocked = Effect.fn("GitWorkbenchDriver.getParsedChangesDiffUnlocked")(
    function* (input: {
      readonly workspace: RegisteredGitWorkspace;
      readonly path: string;
      readonly source: GitChangesDiffSource;
      readonly file: GitWorkbenchFile;
    }) {
      const paths = input.file.oldPath ? [input.file.oldPath, input.path] : [input.path];
      const args =
        input.file.untracked && input.source === "unstaged"
          ? [
              "diff",
              "--no-index",
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              "--unified=3",
              "--",
              "/dev/null",
              input.path,
            ]
          : [
              "diff",
              ...(input.source === "staged" ? ["--cached"] : []),
              "--patch",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              "--full-index",
              "--unified=3",
              "--",
              ...paths,
            ];
      const result = yield* runGit(input.workspace, "GitWorkbenchDriver.getChangesDiff", args, {
        allowNonZeroExit: input.file.untracked && input.source === "unstaged",
        maxOutputBytes: DIFF_MAX_OUTPUT_BYTES,
      });
      if (input.file.untracked && result.exitCode !== 0 && result.exitCode !== 1) {
        return yield* new GitChangeSelectionRestrictedError({
          path: input.path,
          restriction: "unsupported_selection",
          reason: "The untracked file could not be read safely.",
        });
      }
      const identity = input.file.binary
        ? yield* runGit(
            input.workspace,
            "GitWorkbenchDriver.getChangesDiff.binaryIdentity",
            input.source === "staged"
              ? ["ls-files", "--stage", "-z", "--", input.path]
              : ["hash-object", "--no-filters", "--", input.path],
            { allowNonZeroExit: true, maxOutputBytes: 128_000 },
          )
        : null;
      return parseUnifiedChangePatch({
        path: input.path,
        source: input.source,
        rawPatch: result.stdout,
        truncated: result.stdoutTruncated,
        ...(identity
          ? {
              identitySalt: `${String(identity.exitCode)}\0${identity.stdout}\0${identity.stderr}`,
            }
          : {}),
      });
    },
  );

  const getChangesDiffUnlocked = Effect.fn("GitWorkbenchDriver.getChangesDiffUnlocked")(
    function* (input: {
      readonly workspace: RegisteredGitWorkspace;
      readonly path: string;
      readonly source: GitChangesDiffSource;
      readonly expectedStateToken?: string;
    }) {
      const path = yield* validateGitPath(input.path);
      const snapshot = yield* getSnapshotUnlocked(input.workspace).pipe(
        Effect.flatMap(assertRepository),
      );
      yield* assertStateToken(snapshot, input.expectedStateToken);
      const file = yield* findChange(snapshot, path, input.source);
      const parsed = yield* getParsedChangesDiffUnlocked({
        workspace: input.workspace,
        path,
        source: input.source,
        file,
      });
      const diff = safeDiff(parsed, snapshot.stateToken, file.oldPath, file.binary);
      if (!file.conflicted) return diff;
      const readStage = (stage: 1 | 2 | 3) =>
        runGit(
          input.workspace,
          `GitWorkbenchDriver.getConflictVersion.${stage}`,
          ["cat-file", "blob", `:${stage}:${path}`],
          { allowNonZeroExit: true, maxOutputBytes: 1_000_000 },
        ).pipe(
          Effect.map((result) =>
            result.exitCode === 0 && !result.stdoutTruncated ? result.stdout : null,
          ),
        );
      const [base, ours, theirs] = yield* Effect.all([readStage(1), readStage(2), readStage(3)], {
        concurrency: 3,
      });
      return { ...diff, conflictVersions: { base, ours, theirs } };
    },
  );

  const assertSelectionAllowed = (
    file: GitWorkbenchFile,
    diff: ParsedGitChangesDiff,
    selection: GitChangeSelection,
    action: GitApplyChangeSelectionInput["action"],
  ): Effect.Effect<void, GitChangeSelectionRestrictedError> => {
    if (file.conflicted) {
      if (action === "stage" && selection.kind === "file") return Effect.void;
      return Effect.fail(
        new GitChangeSelectionRestrictedError({
          path: file.path,
          restriction: "conflicted_selection",
          reason: "Conflicted paths must use the conflict-resolution workflow.",
        }),
      );
    }
    if (diff.truncated) {
      return Effect.fail(
        new GitChangeSelectionRestrictedError({
          path: file.path,
          restriction: "unsupported_selection",
          reason: "The bounded patch was truncated; refresh with a smaller selection.",
        }),
      );
    }
    if (action === "discard" && file.untracked && selection.kind !== "file") {
      return Effect.fail(
        new GitChangeSelectionRestrictedError({
          path: file.path,
          restriction: "unsupported_selection",
          reason: "Untracked files can only be discarded as a whole file.",
        }),
      );
    }
    if (
      selection.kind !== "file" &&
      (file.binary ||
        diff.binary ||
        file.submodule ||
        file.modeChanged ||
        file.oldPath !== undefined)
    ) {
      return Effect.fail(
        new GitChangeSelectionRestrictedError({
          path: file.path,
          restriction: file.binary || diff.binary ? "binary_selection" : "unsupported_selection",
          reason:
            "Binary, rename, submodule, and mode-only changes support whole-file actions only.",
        }),
      );
    }
    return Effect.void;
  };

  const runWholeFileAction = Effect.fn("GitWorkbenchDriver.runWholeFileAction")(function* (
    input: GitApplyChangeSelectionInput & {
      readonly file: GitWorkbenchFile;
      readonly snapshot: GitWorkbenchSnapshot;
    },
  ) {
    const paths = input.file.oldPath ? [input.file.oldPath, input.path] : [input.path];
    if (input.action === "stage") {
      yield* runGit(input.workspace, "GitWorkbenchDriver.stageFile", ["add", "-A", "--", ...paths]);
      return;
    }
    if (input.action === "unstage") {
      if (input.snapshot.unborn) {
        yield* runGit(input.workspace, "GitWorkbenchDriver.unstageInitialFile", [
          "rm",
          "--cached",
          "--quiet",
          "--ignore-unmatch",
          "--",
          ...paths,
        ]);
        return;
      }
      yield* runGit(input.workspace, "GitWorkbenchDriver.unstageFile", [
        "restore",
        "--staged",
        "--",
        ...paths,
      ]);
      return;
    }
    if (input.file.untracked) {
      yield* runGit(input.workspace, "GitWorkbenchDriver.discardUntrackedFile", [
        "clean",
        "-f",
        "--",
        input.path,
      ]);
      return;
    }
    if (input.file.oldPath) {
      if (input.file.indexStatus === "renamed" || input.file.indexStatus === "copied") {
        yield* runGit(input.workspace, "GitWorkbenchDriver.discardRenamedWorktreeChange", [
          "restore",
          "--worktree",
          "--",
          input.path,
        ]);
        return;
      }
      yield* runGit(input.workspace, "GitWorkbenchDriver.restoreRenameSource", [
        "restore",
        "--worktree",
        "--",
        input.file.oldPath,
      ]);
      yield* runGit(input.workspace, "GitWorkbenchDriver.removeRenameTarget", [
        "clean",
        "-f",
        "--",
        input.path,
      ]);
      return;
    }
    yield* runGit(input.workspace, "GitWorkbenchDriver.discardFile", [
      "restore",
      "--worktree",
      "--",
      input.path,
    ]);
  });

  const runPartialAction = Effect.fn("GitWorkbenchDriver.runPartialAction")(function* (
    input: GitApplyChangeSelectionInput,
    patch: string,
  ) {
    const args = ["apply"];
    if (input.action === "stage" || input.action === "unstage") args.push("--cached");
    if (input.action === "unstage" || input.action === "discard") args.push("--reverse");
    args.push("--recount", "--unidiff-zero", "--whitespace=nowarn", "-");
    yield* runGit(input.workspace, `GitWorkbenchDriver.${input.action}Selection`, args, {
      stdin: patch,
      maxOutputBytes: 128_000,
    });
  });

  const applyChangeSelectionUnlocked = Effect.fn("GitWorkbenchDriver.applyChangeSelectionUnlocked")(
    function* (input: GitApplyChangeSelectionInput) {
      const path = yield* validateGitPath(input.path);
      const sourceMatchesAction =
        (input.action === "stage" && input.source === "unstaged") ||
        (input.action === "unstage" && input.source === "staged") ||
        (input.action === "discard" && input.source === "unstaged");
      if (!sourceMatchesAction) {
        return yield* new GitChangeSelectionRestrictedError({
          path,
          restriction: "unsupported_selection",
          reason: `The ${input.action} action is not valid for ${input.source} changes.`,
        });
      }

      const snapshot = yield* getSnapshotUnlocked(input.workspace).pipe(
        Effect.flatMap(assertRepository),
      );
      yield* assertStateToken(snapshot, input.expectedStateToken);
      const file = yield* findChange(snapshot, path, input.source);
      const diff = yield* getParsedChangesDiffUnlocked({
        workspace: input.workspace,
        path,
        source: input.source,
        file,
      });
      if (diff.patchId !== input.expectedPatchId) {
        return yield* new GitWorkbenchStaleStateError({
          expectedStateToken: input.expectedPatchId,
          actualStateToken: diff.patchId,
          reason: "patch_changed",
        });
      }
      yield* assertSelectionAllowed(file, diff, input.selection, input.action);

      if (
        input.action === "discard" &&
        file.untracked &&
        input.confirmedUntrackedDeletion !== true
      ) {
        return yield* new GitChangeSelectionRestrictedError({
          path,
          restriction: "destructive_confirmation_required",
          reason: "Deleting an untracked file requires explicit destructive confirmation.",
        });
      }

      if (input.selection.kind === "file") {
        yield* runWholeFileAction({ ...input, path, file, snapshot });
        return yield* getSnapshotUnlocked(input.workspace);
      }

      const patch = yield* Effect.try({
        try: () => buildSelectedPatch(diff, input.selection),
        catch: (cause) =>
          new GitChangeSelectionRestrictedError({
            path,
            restriction: "unsupported_selection",
            reason:
              cause instanceof GitChangeSelectionInvalidError
                ? cause.message
                : "The selected patch could not be regenerated.",
          }),
      });
      yield* runPartialAction({ ...input, path }, patch);
      return yield* getSnapshotUnlocked(input.workspace);
    },
  );

  const getSnapshot: GitWorkbenchDriverService["getSnapshot"] = (workspace) =>
    lockFor(workspace.cwd).withPermits(1)(getSnapshotUnlocked(workspace));

  const getChangesDiff: GitWorkbenchDriverService["getChangesDiff"] = (input) =>
    lockFor(input.workspace.cwd).withPermits(1)(getChangesDiffUnlocked(input));

  const applyChangeSelection: GitWorkbenchDriverService["applyChangeSelection"] = (input) =>
    lockFor(input.workspace.cwd).withPermits(1)(applyChangeSelectionUnlocked(input));

  return GitWorkbenchDriver.of({ getSnapshot, getChangesDiff, applyChangeSelection });
});

export const layer = Layer.effect(GitWorkbenchDriver, make);
