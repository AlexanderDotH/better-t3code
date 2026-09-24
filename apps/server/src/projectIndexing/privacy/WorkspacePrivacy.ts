// @effect-diagnostics nodeBuiltinImport:off
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { isSecretKnowledgeGraphPath } from "../../knowledge-graph/extraction/KnowledgeGraphPathPolicy.ts";
import { projectArtifactPathReason } from "./ProjectArtifactPathPolicy.ts";

const execFileAsync = NodeUtil.promisify(NodeChildProcess.execFile);
const PRIVATE_DIRECTORY = ".t3";
export const KNOWLEDGE_DIRECTORY = ".t3/knowledge";
export const PRIVATE_PROJECT_GIT_PATHSPECS = [
  ":(top,exclude,glob).t3/**",
  ":(top,exclude,glob)**/.t3/**",
  ":(top,exclude,literal).t3",
  ":(top,exclude,glob)**/.t3",
] as const;

export class KnowledgePrivacyError extends Schema.TaggedError<KnowledgePrivacyError>()(
  "KnowledgePrivacyError",
  { code: Schema.String, detail: Schema.String, cause: Schema.optional(Schema.Defect()) },
) {
  override get message() {
    return this.detail;
  }
}
const isKnowledgePrivacyError = Schema.is(KnowledgePrivacyError);
const PRIVATE_SOURCE_DIRECTORIES = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".azure",
  ".kube",
  ".gnupg",
  ".config",
  ".local",
]);

export interface KnowledgeWorkspace {
  readonly workspaceRoot: string;
  readonly workspaceId: string;
  readonly knowledgeRoot: string;
  readonly databasePath: string;
}

export function isPrivateProjectPath(relativePath: string): boolean {
  return relativePath
    .replaceAll("\\", "/")
    .split("/")
    .some((part) => part.toLowerCase() === PRIVATE_DIRECTORY);
}

/** Use before staging, committing, exporting, or attaching workspace paths. */
export function assertPublicProjectPaths(paths: ReadonlyArray<string>): void {
  if (paths.some(isPrivateProjectPath)) {
    throw new KnowledgePrivacyError({
      code: "private-path",
      detail: "Private .t3 workspace data cannot be staged, committed, exported, or attached.",
    });
  }
}

export function isWorkspaceRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !/\p{Cc}/u.test(normalized) &&
    !NodePath.isAbsolute(normalized) &&
    !/^[a-z]:/iu.test(normalized) &&
    !normalized.split("/").some((part) => part === "..")
  );
}

export function isSafeProjectSourcePath(relativePath: string): boolean {
  const normalized = relativePath.replaceAll("\\", "/");
  return (
    isWorkspaceRelativePath(normalized) &&
    !normalized.split("/").some((part) => PRIVATE_SOURCE_DIRECTORIES.has(part.toLowerCase())) &&
    !isPrivateProjectPath(normalized) &&
    !isSecretKnowledgeGraphPath(normalized) &&
    projectArtifactPathReason(normalized) === null
  );
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export async function assertNoSymlinkPath(root: string, target: string): Promise<void> {
  const relative = NodePath.relative(root, target);
  if (
    relative === ".." ||
    relative.startsWith(`..${NodePath.sep}`) ||
    NodePath.isAbsolute(relative)
  ) {
    throw new KnowledgePrivacyError({
      code: "outside-workspace",
      detail: "Knowledge paths must stay within the effective workspace.",
    });
  }
  let current = root;
  for (const part of relative.split(NodePath.sep).filter(Boolean)) {
    current = NodePath.join(current, part);
    const stat = await NodeFSP.lstat(current).catch((cause: unknown) => {
      if (isMissing(cause)) return null;
      throw cause;
    });
    if (stat?.isSymbolicLink()) {
      throw new KnowledgePrivacyError({
        code: "symlink",
        detail: "Project indexing does not follow symlinks.",
      });
    }
  }
}

export const resolveKnowledgeWorkspace = Effect.fn("resolveKnowledgeWorkspace")(function* (
  workspaceRoot: string,
) {
  return yield* Effect.tryPromise({
    try: async (): Promise<KnowledgeWorkspace> => {
      const canonicalRoot = await NodeFSP.realpath(workspaceRoot);
      const liveUserdata = NodePath.join(NodeOS.homedir(), ".t3", "userdata");
      if (
        NodePath.basename(canonicalRoot) === PRIVATE_DIRECTORY ||
        canonicalRoot === liveUserdata ||
        canonicalRoot.startsWith(`${liveUserdata}${NodePath.sep}`) ||
        !(await NodeFSP.stat(canonicalRoot)).isDirectory()
      ) {
        throw new KnowledgePrivacyError({
          code: "invalid-workspace",
          detail: "The effective workspace must be a project directory outside private .t3 data.",
        });
      }
      const knowledgeRoot = NodePath.join(canonicalRoot, KNOWLEDGE_DIRECTORY);
      await assertNoSymlinkPath(canonicalRoot, knowledgeRoot);
      return {
        workspaceRoot: canonicalRoot,
        workspaceId: NodeCrypto.createHash("sha256").update(canonicalRoot).digest("hex"),
        knowledgeRoot,
        databasePath: NodePath.join(knowledgeRoot, "knowledge.sqlite"),
      };
    },
    catch: (cause) =>
      isKnowledgePrivacyError(cause)
        ? cause
        : new KnowledgePrivacyError({
            code: "workspace-unavailable",
            detail: "The effective workspace is unavailable for project indexing.",
            cause,
          }),
  });
});

async function appendIgnoreRule(filename: string, rule: string): Promise<void> {
  const previous = await NodeFSP.readFile(filename, "utf8").catch((cause: unknown) => {
    if (isMissing(cause)) return "";
    throw cause;
  });
  if (previous.split(/\r?\n/u).at(-2) === rule) return;
  await NodeFSP.mkdir(NodePath.dirname(filename), { recursive: true });
  await NodeFSP.appendFile(
    filename,
    `${previous.length > 0 && !previous.endsWith("\n") ? "\n" : ""}${rule}\n`,
    {
      mode: 0o600,
      flag:
        NodeFS.constants.O_APPEND |
        NodeFS.constants.O_CREAT |
        NodeFS.constants.O_WRONLY |
        NodeFS.constants.O_NOFOLLOW,
    },
  );
}

async function gitRoot(workspaceRoot: string): Promise<string | null> {
  try {
    return (
      await execFileAsync("git", ["-C", workspaceRoot, "rev-parse", "--show-toplevel"], {
        maxBuffer: 64 * 1024,
      })
    ).stdout.trim();
  } catch (cause) {
    if (
      cause instanceof Error &&
      "stderr" in cause &&
      String(cause.stderr).includes("not a git repository")
    )
      return null;
    throw cause;
  }
}

/** Prepare only local exclusions; tracked private data must be removed by the user. */
export const prepareKnowledgeWorkspace = Effect.fn("prepareKnowledgeWorkspace")(function* (
  workspaceRoot: string,
) {
  const workspace = yield* resolveKnowledgeWorkspace(workspaceRoot);
  yield* Effect.tryPromise({
    try: async () => {
      const repositoryRoot = await gitRoot(workspace.workspaceRoot);
      if (repositoryRoot !== null) {
        const tracked = await execFileAsync(
          "git",
          [
            "-C",
            repositoryRoot,
            "ls-files",
            "-z",
            "--",
            ":(glob).t3/**",
            ":(glob)**/.t3/**",
            ":(glob)**/.t3",
            ".t3",
          ],
          { maxBuffer: 8 * 1024 * 1024 },
        );
        if (tracked.stdout.length > 0) {
          throw new KnowledgePrivacyError({
            code: "tracked-private-path",
            detail:
              "This repository already tracks .t3 data. Remove it from Git before enabling project indexing.",
          });
        }
        const excludePath = (
          await execFileAsync(
            "git",
            [
              "-C",
              workspace.workspaceRoot,
              "rev-parse",
              "--path-format=absolute",
              "--git-path",
              "info/exclude",
            ],
            { maxBuffer: 64 * 1024 },
          )
        ).stdout.trim();
        // Linked worktrees intentionally share the repository's local exclude file.
        const excludeParent = await NodeFSP.realpath(NodePath.dirname(excludePath)).catch(
          (cause: unknown) => {
            if (isMissing(cause)) return NodePath.dirname(excludePath);
            throw cause;
          },
        );
        await assertNoSymlinkPath(excludeParent, excludePath);
        await appendIgnoreRule(excludePath, ".t3/");
      }
      await assertNoSymlinkPath(workspace.workspaceRoot, workspace.knowledgeRoot);
      await NodeFSP.mkdir(workspace.knowledgeRoot, { recursive: true, mode: 0o700 });
      const ignorePath = NodePath.join(workspace.workspaceRoot, PRIVATE_DIRECTORY, ".gitignore");
      await assertNoSymlinkPath(workspace.workspaceRoot, ignorePath);
      // This also protects a directory that becomes a Git repository later.
      await appendIgnoreRule(ignorePath, "*");
      await assertNoSymlinkPath(workspace.workspaceRoot, workspace.databasePath);
    },
    catch: (cause) =>
      isKnowledgePrivacyError(cause)
        ? cause
        : new KnowledgePrivacyError({
            code: "preflight-failed",
            detail:
              "Project indexing could not safely prepare local private storage. Check workspace permissions and Git metadata.",
            cause,
          }),
  });
  return workspace;
});

export const hashProjectSourceFile = Effect.fn("hashProjectSourceFile")(function* (
  workspaceRoot: string,
  relativePath: string,
) {
  if (!isSafeProjectSourcePath(relativePath)) {
    return yield* new KnowledgePrivacyError({
      code: "private-source",
      detail: "Private or out-of-workspace files cannot be indexed.",
    });
  }
  const workspace = yield* resolveKnowledgeWorkspace(workspaceRoot);
  return yield* Effect.tryPromise({
    try: async () => {
      const canonicalRoot = workspace.workspaceRoot;
      const filename = NodePath.resolve(canonicalRoot, relativePath);
      await assertNoSymlinkPath(canonicalRoot, filename);
      const handle = await NodeFSP.open(
        filename,
        NodeFS.constants.O_RDONLY | NodeFS.constants.O_NOFOLLOW,
      );
      try {
        const stat = await handle.stat();
        if (!stat.isFile())
          throw new KnowledgePrivacyError({
            code: "not-source-file",
            detail: "Only regular source files can be indexed.",
          });
        const hash = NodeCrypto.createHash("sha256");
        for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk);
        return hash.digest("hex");
      } finally {
        await handle.close();
      }
    },
    catch: (cause) =>
      isKnowledgePrivacyError(cause)
        ? cause
        : new KnowledgePrivacyError({
            code: "source-unavailable",
            detail: "The source file could not be read safely.",
            cause,
          }),
  });
});
