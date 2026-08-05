import * as NodeCrypto from "node:crypto";

import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  GitCommandError,
  type GitCommitChangedFile,
  type GitCommitDetailInput as ContractGitCommitDetailInput,
  type GitCommitDetailResult,
  type GitCommitFileDiffInput as ContractGitCommitFileDiffInput,
  type GitCommitFileDiffResult,
  type GitCommitFileStatus,
  type GitHistoryItem as ContractGitHistoryItem,
  type GitHistoryListInput,
  type GitHistoryListResult,
  type GitInteractiveRebasePlanInput,
  type GitInteractiveRebasePlanItem,
  type GitInteractiveRebasePlanResult,
  type GitRepositoryActivityBucket,
  type GitRepositoryCodeMixEntry,
  type GitRepositoryContributor,
  type GitRepositoryInsightsInput as ContractGitRepositoryInsightsInput,
  type GitRepositoryInsightsResult,
} from "@t3tools/contracts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";

const HISTORY_PAGE_MAX = 50;
const HISTORY_OUTPUT_MAX_BYTES = 512_000;
const COMMIT_METADATA_MAX_BYTES = 96_000;
const COMMIT_FILES_MAX_BYTES = 512_000;
const COMMIT_PATCH_MAX_BYTES = 120_000;
const INSIGHTS_COMMIT_MAX = 5_000;
const INSIGHTS_LOG_MAX_BYTES = 1_500_000;
const CODE_MIX_PATHS_MAX_BYTES = 2_000_000;
const INSIGHTS_CACHE_CAPACITY = 128;
const INSIGHTS_CACHE_TTL = Duration.minutes(5);
const INTERACTIVE_REBASE_COMMIT_MAX = 2_000;
const INTERACTIVE_REBASE_OUTPUT_MAX_BYTES = 2_000_000;
const GIT_OBJECT_ID_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const SAFE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const isGitCommandError = Schema.is(GitCommandError);

export type GitHistoryInput = GitHistoryListInput;
export type GitHistoryItem = ContractGitHistoryItem;
export type GitHistoryPage = GitHistoryListResult;
export type GitCommitDetailInput = ContractGitCommitDetailInput;
export type GitCommitFile = GitCommitChangedFile;
export type GitCommitDetail = GitCommitDetailResult;
export type GitCommitFileDiffInput = ContractGitCommitFileDiffInput;
export type GitCommitFileDiff = GitCommitFileDiffResult;
export type GitRepositoryInsightsInput = ContractGitRepositoryInsightsInput;
export type GitContributorInsight = GitRepositoryContributor;
export type GitActivityInsight = GitRepositoryActivityBucket;
export type GitCodeMixEntry = GitRepositoryCodeMixEntry;
export type GitCodeMixInsight = GitRepositoryInsightsResult["codeMix"];
export type GitRepositoryInsights = GitRepositoryInsightsResult;

export class GitRepositoryQueryService extends Context.Service<
  GitRepositoryQueryService,
  {
    readonly listHistory: (
      input: GitHistoryInput,
    ) => Effect.Effect<GitHistoryPage, GitCommandError>;
    readonly getCommitDetail: (
      input: GitCommitDetailInput,
    ) => Effect.Effect<GitCommitDetail, GitCommandError>;
    readonly getCommitFileDiff: (
      input: GitCommitFileDiffInput,
    ) => Effect.Effect<GitCommitFileDiff, GitCommandError>;
    readonly getInteractiveRebasePlan: (
      input: GitInteractiveRebasePlanInput,
    ) => Effect.Effect<GitInteractiveRebasePlanResult, GitCommandError>;
    readonly getRepositoryInsights: (
      input: GitRepositoryInsightsInput,
    ) => Effect.Effect<GitRepositoryInsights, GitCommandError>;
  }
>()("t3/git-workbench/GitRepositoryQueryService") {}

export function isGitObjectId(value: string): boolean {
  return GIT_OBJECT_ID_PATTERN.test(value);
}

function validationError(operation: string, cwd: string, detail: string): GitCommandError {
  return new GitCommandError({
    operation,
    command: "git",
    cwd,
    detail,
  });
}

function validateLiteralRepositoryPath(
  operation: string,
  cwd: string,
  path: string,
): GitCommandError | null {
  if (
    path.length === 0 ||
    path.includes("\0") ||
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.split(/[\\/]/u).some((segment) => segment === "..")
  ) {
    return validationError(
      operation,
      cwd,
      "History paths must be repository-relative literal paths.",
    );
  }
  return null;
}

function validateObjectId(operation: string, cwd: string, oid: string): GitCommandError | null {
  return isGitObjectId(oid)
    ? null
    : validationError(operation, cwd, "Expected a full SHA-1 or SHA-256 object ID.");
}

function isSafeRefName(value: string): boolean {
  return (
    SAFE_REF_PATTERN.test(value) &&
    !value.includes("..") &&
    !value.includes("//") &&
    !value.includes("@{") &&
    !value.endsWith(".") &&
    !value.endsWith("/") &&
    !value.endsWith(".lock")
  );
}

function boundedNonEmpty(value: string, maximum: number, fallback: string): string {
  const normalized = value.trim();
  return (normalized || fallback).slice(0, maximum);
}

interface RebaseGraphCommit {
  readonly oid: string;
  readonly parents: readonly string[];
  readonly subject: string;
}

type QueryParseResult<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly error: GitCommandError; readonly ok: false };

function parseRebaseGraph(
  cwd: string,
  stdout: string,
): QueryParseResult<readonly RebaseGraphCommit[]> {
  const fields = nullSeparatedFields(stdout, false);
  const commits: RebaseGraphCommit[] = [];
  for (let offset = 0; offset + 2 < fields.length; offset += 3) {
    const oid = fields[offset] ?? "";
    const parents = (fields[offset + 1] ?? "").split(" ").filter(Boolean);
    if (!isGitObjectId(oid) || parents.some((parent) => !isGitObjectId(parent))) {
      return {
        error: validationError(
          "GitRepositoryQueryService.getInteractiveRebasePlan",
          cwd,
          "Git returned a malformed rebase graph.",
        ),
        ok: false,
      };
    }
    commits.push({
      oid,
      parents,
      subject: boundedNonEmpty(fields[offset + 2] ?? "", 1_000, "(no subject)"),
    });
  }
  return { ok: true, value: commits };
}

function rebaseLabel(oid: string): string {
  return `t3-${oid.slice(0, 16)}`;
}

function buildInteractiveRebaseItems(
  cwd: string,
  commits: readonly RebaseGraphCommit[],
): QueryParseResult<readonly GitInteractiveRebasePlanItem[]> {
  const inRange = new Set(commits.map((commit) => commit.oid));
  const items: GitInteractiveRebasePlanItem[] = [{ node: { kind: "label", name: "onto" } }];
  let currentLabel = "onto";

  for (const commit of commits) {
    if (commit.parents.length > 2) {
      return {
        error: validationError(
          "GitRepositoryQueryService.getInteractiveRebasePlan",
          cwd,
          "Interactive rebase does not support octopus merge commits.",
        ),
        ok: false,
      };
    }
    const firstParent = commit.parents[0];
    const baseLabel = firstParent && inRange.has(firstParent) ? rebaseLabel(firstParent) : "onto";
    if (currentLabel !== baseLabel) {
      items.push({ node: { kind: "reset", label: baseLabel } });
    }

    if (commit.parents.length === 2) {
      const mergedParent = commit.parents[1]!;
      if (!inRange.has(mergedParent)) {
        return {
          error: validationError(
            "GitRepositoryQueryService.getInteractiveRebasePlan",
            cwd,
            "A merge parent falls outside the selected rebase range.",
          ),
          ok: false,
        };
      }
      items.push({
        node: {
          kind: "merge",
          label: rebaseLabel(mergedParent),
          originalOid: commit.oid,
          messageMode: "reuse",
        },
        parents: commit.parents,
        subject: commit.subject,
      });
    } else {
      items.push({
        node: { kind: "pick", oid: commit.oid },
        parents: commit.parents,
        subject: commit.subject,
      });
    }
    currentLabel = rebaseLabel(commit.oid);
    items.push({ node: { kind: "label", name: currentLabel } });
  }
  return { ok: true, value: items };
}

function parseHistory(stdout: string, truncated: boolean): ReadonlyArray<GitHistoryItem> {
  const fields = nullSeparatedFields(stdout, truncated);
  const items: Array<GitHistoryItem> = [];
  for (let offset = 0; offset + 7 < fields.length; offset += 8) {
    const oid = fields[offset] ?? "";
    if (!isGitObjectId(oid)) break;
    items.push({
      oid,
      shortOid: fields[offset + 1] ?? oid.slice(0, 8),
      subject: boundedNonEmpty(fields[offset + 2] ?? "", 1_000, "(no subject)"),
      authorName: boundedNonEmpty(fields[offset + 3] ?? "", 512, "Unknown"),
      authoredAt: fields[offset + 4] ?? "",
      committedAt: fields[offset + 5] ?? "",
      parents: (fields[offset + 6] ?? "").split(" ").filter(Boolean),
      decorations: (fields[offset + 7] ?? "")
        .split("\x1f")
        .map((decoration) => boundedNonEmpty(decoration, 1_024, ""))
        .filter(Boolean),
    });
  }
  return items;
}

interface CommitMetadata {
  readonly oid: string;
  readonly subject: string;
  readonly body: string;
  readonly authorName: string;
  readonly committerName: string;
  readonly authoredAt: string;
  readonly committedAt: string;
  readonly parents: ReadonlyArray<string>;
}

function parseCommitMetadata(cwd: string, stdout: string): CommitMetadata | GitCommandError {
  const [
    oid = "",
    subject = "",
    authorName = "",
    committerName = "",
    authoredAt = "",
    committedAt = "",
    parents = "",
    body = "",
  ] = stdout.split("\0");
  if (!isGitObjectId(oid)) {
    return validationError(
      "GitRepositoryQueryService.getCommitDetail",
      cwd,
      "Git returned malformed commit metadata.",
    );
  }
  return {
    oid,
    subject: boundedNonEmpty(subject, 1_000, "(no subject)"),
    body,
    authorName: boundedNonEmpty(authorName, 512, "Unknown"),
    committerName: boundedNonEmpty(committerName, 512, "Unknown"),
    authoredAt,
    committedAt,
    parents: parents.split(" ").filter(Boolean),
  };
}

interface CommitFileStatusEntry {
  readonly path: string;
  readonly oldPath?: string;
  readonly status: GitCommitFileStatus;
}

interface CommitFileStats {
  readonly additions?: number;
  readonly deletions?: number;
  readonly binary: boolean;
}

function nullSeparatedFields(stdout: string, truncated: boolean): Array<string> {
  const fields = stdout.split("\0");
  if (fields.at(-1) === "") fields.pop();
  if (truncated && !stdout.endsWith("\0")) fields.pop();
  return fields;
}

function statusName(code: string): GitCommitFileStatus {
  switch (code.charAt(0)) {
    case "A":
      return "added";
    case "M":
      return "modified";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "copied";
    case "T":
      return "type-changed";
    case "U":
      return "unmerged";
    default:
      return "unknown";
  }
}

function parseCommitFileStatuses(
  stdout: string,
  truncated: boolean,
): ReadonlyArray<CommitFileStatusEntry> {
  const fields = nullSeparatedFields(stdout, truncated);
  const entries: Array<CommitFileStatusEntry> = [];
  for (let index = 0; index < fields.length; ) {
    const code = fields[index++] ?? "";
    const status = statusName(code);
    if (status === "renamed" || status === "copied") {
      const oldPath = fields[index++];
      const path = fields[index++];
      if (!oldPath || !path) break;
      entries.push({ path, oldPath, status });
      continue;
    }
    const path = fields[index++];
    if (!path) break;
    entries.push({ path, status });
  }
  return entries;
}

function parseCount(value: string): number | null {
  if (value === "-") return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseCommitFileStats(
  stdout: string,
  truncated: boolean,
): ReadonlyMap<string, CommitFileStats> {
  const fields = nullSeparatedFields(stdout, truncated);
  const stats = new Map<string, CommitFileStats>();
  for (let index = 0; index < fields.length; ) {
    const header = fields[index++] ?? "";
    const additionsEnd = header.indexOf("\t");
    const deletionsEnd = header.indexOf("\t", additionsEnd + 1);
    if (additionsEnd < 0 || deletionsEnd < 0) break;
    const additionsText = header.slice(0, additionsEnd);
    const deletionsText = header.slice(additionsEnd + 1, deletionsEnd);
    const inlinePath = header.slice(deletionsEnd + 1);
    const additions = parseCount(additionsText);
    const deletions = parseCount(deletionsText);
    const binary = additions === null || deletions === null;
    const parsedStats = {
      ...(additions !== null ? { additions } : {}),
      ...(deletions !== null ? { deletions } : {}),
      binary,
    } satisfies CommitFileStats;
    if (inlinePath) {
      stats.set(inlinePath, parsedStats);
      continue;
    }
    const oldPath = fields[index++];
    const path = fields[index++];
    if (!oldPath || !path) break;
    stats.set(path, parsedStats);
  }
  return stats;
}

interface InsightCommit {
  readonly displayName: string;
  readonly email: string;
  readonly authoredAt: string;
}

function parseInsightCommits(stdout: string, truncated: boolean): ReadonlyArray<InsightCommit> {
  const fields = nullSeparatedFields(stdout, truncated);
  const commits: Array<InsightCommit> = [];
  for (let offset = 0; offset + 2 < fields.length; offset += 3) {
    const displayName = fields[offset] ?? "";
    const email = fields[offset + 1] ?? "";
    const authoredAt = fields[offset + 2] ?? "";
    if (!displayName || !authoredAt) break;
    commits.push({ displayName, email, authoredAt });
  }
  return commits;
}

function identityKey(name: string, email: string): string {
  return NodeCrypto.createHash("sha256")
    .update(name.trim().toLocaleLowerCase("en-US"))
    .update("\0")
    .update(email.trim().toLocaleLowerCase("en-US"))
    .digest("hex");
}

function insightWindow(now: DateTime.Utc): { start: DateTime.Utc; end: DateTime.Utc } {
  return { start: DateTime.subtract(now, { months: 12 }), end: now };
}

function activityBuckets(
  commits: ReadonlyArray<InsightCommit>,
  start: DateTime.Utc,
  end: DateTime.Utc,
): ReadonlyArray<GitActivityInsight> {
  const counts = new Map<string, number>();
  for (const commit of commits) {
    const authoredAt = DateTime.make(commit.authoredAt);
    if (Option.isNone(authoredAt)) continue;
    const date = DateTime.formatIsoDateUtc(authoredAt.value);
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  const buckets: Array<GitActivityInsight> = [];
  let cursor = DateTime.startOf(start, "day");
  const last = DateTime.toEpochMillis(DateTime.startOf(end, "day"));
  while (DateTime.toEpochMillis(cursor) <= last) {
    const date = DateTime.formatIsoDateUtc(cursor);
    buckets.push({ date, commitCount: counts.get(date) ?? 0 });
    cursor = DateTime.add(cursor, { days: 1 });
  }
  return buckets;
}

function contributorInsights(
  commits: ReadonlyArray<InsightCommit>,
): ReadonlyArray<GitContributorInsight> {
  const contributors = new Map<string, GitContributorInsight>();
  for (const commit of commits) {
    const key = identityKey(commit.displayName, commit.email);
    const current = contributors.get(key);
    contributors.set(key, {
      identityKey: key,
      displayName: boundedNonEmpty(commit.displayName, 512, "Unknown"),
      commitCount: (current?.commitCount ?? 0) + 1,
    });
  }
  return [...contributors.values()].sort(
    (left, right) =>
      right.commitCount - left.commitCount || left.displayName.localeCompare(right.displayName),
  );
}

const EXCLUDED_PATH_SEGMENTS = new Set([
  ".next",
  "build",
  "coverage",
  "dist",
  "generated",
  "node_modules",
  "out",
  "pods",
  "target",
  "third_party",
  "vendor",
  "vendors",
]);

const EXCLUDED_FILE_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "cargo.lock",
  "gemfile.lock",
  "package-lock.json",
  "pnpm-lock.yaml",
  "podfile.lock",
  "yarn.lock",
]);

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = Object.freeze({
  ".astro": "Astro",
  ".bash": "Shell",
  ".c": "C",
  ".cc": "C++",
  ".clj": "Clojure",
  ".cpp": "C++",
  ".cs": "C#",
  ".css": "CSS",
  ".dart": "Dart",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".fish": "Shell",
  ".fs": "F#",
  ".fsx": "F#",
  ".go": "Go",
  ".h": "C",
  ".hpp": "C++",
  ".hs": "Haskell",
  ".htm": "HTML",
  ".html": "HTML",
  ".java": "Java",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".less": "CSS",
  ".lua": "Lua",
  ".m": "Objective-C",
  ".md": "Markdown",
  ".mdx": "Markdown",
  ".mm": "Objective-C++",
  ".php": "PHP",
  ".pl": "Perl",
  ".py": "Python",
  ".qml": "QML",
  ".r": "R",
  ".rb": "Ruby",
  ".rs": "Rust",
  ".sass": "CSS",
  ".scala": "Scala",
  ".scss": "CSS",
  ".sh": "Shell",
  ".sql": "SQL",
  ".svelte": "Svelte",
  ".swift": "Swift",
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".vue": "Vue",
  ".zsh": "Shell",
});

function baseName(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extension(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? "" : name.slice(dot).toLocaleLowerCase("en-US");
}

function shouldExcludeFromCodeMix(path: string): boolean {
  const normalized = path.toLocaleLowerCase("en-US");
  const name = baseName(normalized);
  if (EXCLUDED_FILE_NAMES.has(name)) return true;
  if (/\.(?:generated|gen)\.[^.]+$/u.test(name)) return true;
  if (/\.min\.(?:css|js)$/u.test(name)) return true;
  return normalized.split("/").some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment));
}

function classifyLanguage(path: string): string | null {
  const name = baseName(path).toLocaleLowerCase("en-US");
  if (name === "dockerfile" || name.startsWith("dockerfile.")) return "Dockerfile";
  return LANGUAGE_BY_EXTENSION[extension(path)] ?? null;
}

function codeMixInsight(stdout: string, truncated: boolean): GitCodeMixInsight {
  const paths = nullSeparatedFields(stdout, truncated);
  const counts = new Map<string, number>();
  let excludedFileCount = 0;
  for (const path of paths) {
    if (shouldExcludeFromCodeMix(path)) {
      excludedFileCount += 1;
      continue;
    }
    const language = classifyLanguage(path);
    if (!language) continue;
    counts.set(language, (counts.get(language) ?? 0) + 1);
  }
  const classifiedFileCount = [...counts.values()].reduce((total, count) => total + count, 0);
  const ranked = [...counts.entries()].sort(
    ([leftName, leftCount], [rightName, rightCount]) =>
      rightCount - leftCount || leftName.localeCompare(rightName),
  );
  const top = ranked.slice(0, 5);
  const otherCount = ranked.slice(5).reduce((total, [, count]) => total + count, 0);
  const entries = [...top, ...(otherCount > 0 ? [["Other", otherCount] as const] : [])].map(
    ([language, fileCount]) => ({
      language,
      fileCount,
      percentage:
        classifiedFileCount === 0 ? 0 : Math.round((fileCount / classifiedFileCount) * 1_000) / 10,
    }),
  );
  return {
    entries,
    trackedFileCount: paths.length,
    classifiedFileCount,
    excludedFileCount,
    scannedFileCount: paths.length,
    truncated,
  };
}

export const make = Effect.gen(function* () {
  const git = yield* GitVcsDriver.GitVcsDriver;

  const resolveHead = Effect.fn("GitRepositoryQueryService.resolveHead")(function* (cwd: string) {
    const result = yield* git.execute({
      operation: "GitRepositoryQueryService.resolveHead",
      cwd,
      args: ["rev-parse", "--verify", "HEAD^{commit}"],
      allowNonZeroExit: true,
      timeoutMs: 10_000,
      maxOutputBytes: 256,
    });
    if (result.exitCode !== 0) {
      const symbolicHead = yield* git.execute({
        operation: "GitRepositoryQueryService.resolveHead.unborn",
        cwd,
        args: ["symbolic-ref", "-q", "HEAD"],
        allowNonZeroExit: true,
        timeoutMs: 10_000,
        maxOutputBytes: 4_096,
      });
      if (symbolicHead.exitCode === 0) return null;
      return yield* validationError(
        "GitRepositoryQueryService.resolveHead",
        cwd,
        result.stderr.trim() || "HEAD does not resolve to a commit.",
      );
    }
    const oid = result.stdout.trim();
    if (!isGitObjectId(oid)) {
      return yield* validationError(
        "GitRepositoryQueryService.resolveHead",
        cwd,
        "Git returned an invalid HEAD object ID.",
      );
    }
    return oid;
  });

  const resolveHistoryRef = Effect.fn("GitRepositoryQueryService.resolveHistoryRef")(function* (
    cwd: string,
    refName: string,
  ) {
    if (!isSafeRefName(refName)) {
      return yield* validationError(
        "GitRepositoryQueryService.resolveHistoryRef",
        cwd,
        "History refs must be literal branch or remote-ref names.",
      );
    }
    const result = yield* git.execute({
      operation: "GitRepositoryQueryService.resolveHistoryRef",
      cwd,
      args: ["rev-parse", "--verify", "--end-of-options", `${refName}^{commit}`],
      allowNonZeroExit: true,
      timeoutMs: 10_000,
      maxOutputBytes: 256,
    });
    const oid = result.stdout.trim();
    if (result.exitCode !== 0 || !isGitObjectId(oid)) {
      return yield* validationError(
        "GitRepositoryQueryService.resolveHistoryRef",
        cwd,
        "The selected history ref no longer resolves to a commit.",
      );
    }
    return oid;
  });

  const listHistory = Effect.fn("GitRepositoryQueryService.listHistory")(function* (
    input: GitHistoryInput,
  ) {
    if (input.snapshotOid && !isGitObjectId(input.snapshotOid)) {
      return yield* validationError(
        "GitRepositoryQueryService.listHistory",
        input.cwd,
        "Invalid history snapshot object ID.",
      );
    }
    if (input.cursor !== undefined && (!Number.isSafeInteger(input.cursor) || input.cursor < 0)) {
      return yield* validationError(
        "GitRepositoryQueryService.listHistory",
        input.cwd,
        "Invalid history cursor.",
      );
    }
    if ((input.cursor ?? 0) > 0 && !input.snapshotOid) {
      return yield* validationError(
        "GitRepositoryQueryService.listHistory",
        input.cwd,
        "A history snapshot object ID is required after the first page.",
      );
    }
    if (input.path) {
      const pathError = validateLiteralRepositoryPath(
        "GitRepositoryQueryService.listHistory",
        input.cwd,
        input.path,
      );
      if (pathError) return yield* pathError;
    }
    if (input.refName && !isSafeRefName(input.refName)) {
      return yield* validationError(
        "GitRepositoryQueryService.listHistory",
        input.cwd,
        "History refs must be literal branch or remote-ref names.",
      );
    }

    const snapshotOid =
      input.snapshotOid ??
      (input.refName
        ? yield* resolveHistoryRef(input.cwd, input.refName)
        : yield* resolveHead(input.cwd));
    if (snapshotOid === null) {
      return {
        snapshotOid: null,
        items: [],
        nextCursor: null,
        truncated: false,
      } satisfies GitHistoryPage;
    }
    const offset = input.cursor ?? 0;
    const limit = Math.min(HISTORY_PAGE_MAX, Math.max(1, Math.floor(input.limit ?? 50)));
    const result = yield* git.execute({
      operation: "GitRepositoryQueryService.listHistory",
      cwd: input.cwd,
      args: [
        "--literal-pathspecs",
        "log",
        "--topo-order",
        "--date-order",
        "--decorate=short",
        "--format=%H%x00%h%x00%s%x00%aN%x00%aI%x00%cI%x00%P%x00%(decorate:prefix=,suffix=,separator=%x1f)",
        "-z",
        `--skip=${offset}`,
        `--max-count=${limit + 1}`,
        snapshotOid,
        ...(input.path ? ["--", input.path] : []),
      ],
      timeoutMs: 15_000,
      maxOutputBytes: HISTORY_OUTPUT_MAX_BYTES,
      appendTruncationMarker: true,
    });
    const parsed = parseHistory(result.stdout, result.stdoutTruncated);
    const items = parsed.slice(0, limit);
    const hasNextPage = parsed.length > limit || (result.stdoutTruncated && items.length > 0);
    return {
      snapshotOid,
      items,
      nextCursor: hasNextPage ? offset + items.length : null,
      truncated: result.stdoutTruncated,
    } satisfies GitHistoryPage;
  });

  const readCommitMetadata = Effect.fn("GitRepositoryQueryService.readCommitMetadata")(function* (
    input: GitCommitDetailInput,
  ) {
    const oidError = validateObjectId(
      "GitRepositoryQueryService.getCommitDetail",
      input.cwd,
      input.oid,
    );
    if (oidError) return yield* oidError;
    const result = yield* git.execute({
      operation: "GitRepositoryQueryService.getCommitDetail.metadata",
      cwd: input.cwd,
      args: [
        "show",
        "-s",
        "--no-patch",
        "--use-mailmap",
        "--format=%H%x00%s%x00%aN%x00%cN%x00%aI%x00%cI%x00%P%x00%b",
        "-z",
        input.oid,
      ],
      timeoutMs: 10_000,
      maxOutputBytes: COMMIT_METADATA_MAX_BYTES,
      appendTruncationMarker: true,
    });
    const metadata = parseCommitMetadata(input.cwd, result.stdout);
    if (isGitCommandError(metadata)) return yield* metadata;
    return { metadata, truncated: result.stdoutTruncated };
  });

  const getCommitDetail = Effect.fn("GitRepositoryQueryService.getCommitDetail")(function* (
    input: GitCommitDetailInput,
  ) {
    const { metadata, truncated: metadataTruncated } = yield* readCommitMetadata(input);
    const firstParent = metadata.parents[0];
    const diffArgs = (format: "--name-status" | "--numstat"): ReadonlyArray<string> =>
      firstParent
        ? [
            "--literal-pathspecs",
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "-M",
            format,
            "-z",
            firstParent,
            input.oid,
          ]
        : ["diff-tree", "--root", "--no-commit-id", "-r", "-M", format, "-z", input.oid];
    const [statusResult, statsResult] = yield* Effect.all(
      [
        git.execute({
          operation: "GitRepositoryQueryService.getCommitDetail.status",
          cwd: input.cwd,
          args: diffArgs("--name-status"),
          timeoutMs: 15_000,
          maxOutputBytes: COMMIT_FILES_MAX_BYTES,
          appendTruncationMarker: true,
        }),
        git.execute({
          operation: "GitRepositoryQueryService.getCommitDetail.stats",
          cwd: input.cwd,
          args: diffArgs("--numstat"),
          timeoutMs: 15_000,
          maxOutputBytes: COMMIT_FILES_MAX_BYTES,
          appendTruncationMarker: true,
        }),
      ],
      { concurrency: 2 },
    );
    const statuses = parseCommitFileStatuses(statusResult.stdout, statusResult.stdoutTruncated);
    const stats = parseCommitFileStats(statsResult.stdout, statsResult.stdoutTruncated);
    return {
      ...metadata,
      files: statuses.map((entry) => ({
        ...entry,
        ...(stats.get(entry.path) ?? { additions: 0, deletions: 0, binary: false }),
      })),
      truncated: metadataTruncated || statusResult.stdoutTruncated || statsResult.stdoutTruncated,
    } satisfies GitCommitDetail;
  });

  const getCommitFileDiff = Effect.fn("GitRepositoryQueryService.getCommitFileDiff")(function* (
    input: GitCommitFileDiffInput,
  ) {
    const oidError = validateObjectId(
      "GitRepositoryQueryService.getCommitFileDiff",
      input.cwd,
      input.oid,
    );
    if (oidError) return yield* oidError;
    for (const path of [input.oldPath, input.path]) {
      if (!path) continue;
      const pathError = validateLiteralRepositoryPath(
        "GitRepositoryQueryService.getCommitFileDiff",
        input.cwd,
        path,
      );
      if (pathError) return yield* pathError;
    }
    const result = yield* git.execute({
      operation: "GitRepositoryQueryService.getCommitFileDiff",
      cwd: input.cwd,
      args: [
        "--literal-pathspecs",
        "show",
        "--format=",
        "--first-parent",
        "--no-ext-diff",
        "--no-textconv",
        "--find-renames",
        "--patch",
        input.oid,
        "--",
        ...(input.oldPath ? [input.oldPath] : []),
        input.path,
      ],
      timeoutMs: 15_000,
      maxOutputBytes: COMMIT_PATCH_MAX_BYTES,
      appendTruncationMarker: true,
    });
    return {
      oid: input.oid,
      path: input.path,
      ...(input.oldPath ? { oldPath: input.oldPath } : {}),
      patch: result.stdout,
      binary: /^(?:Binary files |GIT binary patch$)/mu.test(result.stdout),
      truncated: result.stdoutTruncated,
    } satisfies GitCommitFileDiff;
  });

  const getInteractiveRebasePlan = Effect.fn("GitRepositoryQueryService.getInteractiveRebasePlan")(
    function* (input: GitInteractiveRebasePlanInput) {
      const resolved = yield* git.execute({
        operation: "GitRepositoryQueryService.getInteractiveRebasePlan.resolve",
        cwd: input.cwd,
        args: ["rev-parse", "--verify", "--end-of-options", `${input.upstreamRef}^{commit}`],
        timeoutMs: 10_000,
        maxOutputBytes: 256,
      });
      const upstreamOid = resolved.stdout.trim();
      if (!isGitObjectId(upstreamOid)) {
        return yield* validationError(
          "GitRepositoryQueryService.getInteractiveRebasePlan",
          input.cwd,
          "The selected upstream ref did not resolve to a commit.",
        );
      }
      const graph = yield* git.execute({
        operation: "GitRepositoryQueryService.getInteractiveRebasePlan.graph",
        cwd: input.cwd,
        args: [
          "log",
          "--reverse",
          "--topo-order",
          `--max-count=${INTERACTIVE_REBASE_COMMIT_MAX + 1}`,
          "--format=%H%x00%P%x00%s",
          "-z",
          `${upstreamOid}..HEAD`,
        ],
        timeoutMs: 20_000,
        maxOutputBytes: INTERACTIVE_REBASE_OUTPUT_MAX_BYTES,
      });
      const parsed = parseRebaseGraph(input.cwd, graph.stdout);
      if (!parsed.ok) return yield* parsed.error;
      if (parsed.value.length === 0) {
        return yield* validationError(
          "GitRepositoryQueryService.getInteractiveRebasePlan",
          input.cwd,
          "HEAD has no commits to rebase onto the selected ref.",
        );
      }
      if (parsed.value.length > INTERACTIVE_REBASE_COMMIT_MAX || graph.stdoutTruncated) {
        return yield* validationError(
          "GitRepositoryQueryService.getInteractiveRebasePlan",
          input.cwd,
          `Interactive rebase is limited to ${INTERACTIVE_REBASE_COMMIT_MAX} commits.`,
        );
      }
      const items = buildInteractiveRebaseItems(input.cwd, parsed.value);
      if (!items.ok) return yield* items.error;
      return { upstreamRef: input.upstreamRef, upstreamOid, items: items.value };
    },
  );

  const loadRepositoryInsights = Effect.fn("GitRepositoryQueryService.loadRepositoryInsights")(
    function* (key: string) {
      const [gitCommonDir = "", snapshotOid = ""] = key.split("\0");
      if (!gitCommonDir || !isGitObjectId(snapshotOid)) {
        return yield* validationError(
          "GitRepositoryQueryService.getRepositoryInsights",
          gitCommonDir,
          "Invalid repository insights cache key.",
        );
      }
      const window = insightWindow(yield* DateTime.now);
      const [logResult, trackedFilesResult] = yield* Effect.all(
        [
          git.execute({
            operation: "GitRepositoryQueryService.getRepositoryInsights.history",
            cwd: gitCommonDir,
            args: [
              "-c",
              `mailmap.blob=${snapshotOid}:.mailmap`,
              "log",
              "--use-mailmap",
              "--format=%aN%x00%aE%x00%aI",
              "-z",
              `--since=${DateTime.formatIso(window.start)}`,
              `--max-count=${INSIGHTS_COMMIT_MAX + 1}`,
              snapshotOid,
            ],
            timeoutMs: 30_000,
            maxOutputBytes: INSIGHTS_LOG_MAX_BYTES,
            appendTruncationMarker: true,
          }),
          git.execute({
            operation: "GitRepositoryQueryService.getRepositoryInsights.codeMix",
            cwd: gitCommonDir,
            args: ["ls-tree", "-r", "--name-only", "-z", snapshotOid],
            timeoutMs: 30_000,
            maxOutputBytes: CODE_MIX_PATHS_MAX_BYTES,
            appendTruncationMarker: true,
          }),
        ],
        { concurrency: 2 },
      );
      const parsedCommits = parseInsightCommits(logResult.stdout, logResult.stdoutTruncated);
      const commits = parsedCommits.slice(0, INSIGHTS_COMMIT_MAX);
      return {
        snapshotOid,
        windowStart: DateTime.formatIso(window.start),
        windowEnd: DateTime.formatIso(window.end),
        scannedCommits: commits.length,
        truncated: logResult.stdoutTruncated || parsedCommits.length > INSIGHTS_COMMIT_MAX,
        contributors: contributorInsights(commits),
        activity: activityBuckets(commits, window.start, window.end),
        codeMix: codeMixInsight(trackedFilesResult.stdout, trackedFilesResult.stdoutTruncated),
      } satisfies GitRepositoryInsights;
    },
  );
  const repositoryInsightsCache = yield* Cache.makeWith(loadRepositoryInsights, {
    capacity: INSIGHTS_CACHE_CAPACITY,
    timeToLive: (exit) => (Exit.isSuccess(exit) ? INSIGHTS_CACHE_TTL : Duration.zero),
  });

  const getRepositoryInsights = Effect.fn("GitRepositoryQueryService.getRepositoryInsights")(
    function* (input: GitRepositoryInsightsInput) {
      const [commonDirResult, snapshotOid] = yield* Effect.all(
        [
          git.execute({
            operation: "GitRepositoryQueryService.getRepositoryInsights.commonDir",
            cwd: input.cwd,
            args: ["rev-parse", "--path-format=absolute", "--git-common-dir"],
            timeoutMs: 10_000,
            maxOutputBytes: 4_096,
          }),
          resolveHead(input.cwd),
        ],
        { concurrency: 2 },
      );
      const gitCommonDir = commonDirResult.stdout.trim();
      if (!gitCommonDir || gitCommonDir.includes("\0")) {
        return yield* validationError(
          "GitRepositoryQueryService.getRepositoryInsights",
          input.cwd,
          "Git returned an invalid common directory.",
        );
      }
      if (snapshotOid === null) {
        const window = insightWindow(yield* DateTime.now);
        return {
          snapshotOid: null,
          windowStart: DateTime.formatIso(window.start),
          windowEnd: DateTime.formatIso(window.end),
          scannedCommits: 0,
          truncated: false,
          contributors: [],
          activity: activityBuckets([], window.start, window.end),
          codeMix: {
            entries: [],
            trackedFileCount: 0,
            classifiedFileCount: 0,
            excludedFileCount: 0,
            scannedFileCount: 0,
            truncated: false,
          },
        } satisfies GitRepositoryInsights;
      }
      return yield* Cache.get(repositoryInsightsCache, `${gitCommonDir}\0${snapshotOid}`);
    },
  );

  return GitRepositoryQueryService.of({
    listHistory,
    getCommitDetail,
    getCommitFileDiff,
    getInteractiveRebasePlan,
    getRepositoryInsights,
  });
});

export const layer = Layer.effect(GitRepositoryQueryService, make);
