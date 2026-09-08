import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import { GitWorkbenchOperationsDriver } from "./GitWorkbenchOperations.ts";
import {
  GitWorkbenchUndoError,
  type GitWorkbenchUndoReason,
  type GitWorkbenchUndoSnapshot,
} from "./GitWorkbenchUndoService.ts";

export interface GitWorkbenchUndoCaptureInput {
  readonly id: string;
  readonly cwd: string;
  readonly reason: GitWorkbenchUndoReason;
  readonly createdAt: number;
  readonly expiresAt: number;
  readonly refNamespace: string;
  readonly capturedStateToken: string | null;
}

export class GitWorkbenchUndoDriver extends Context.Service<
  GitWorkbenchUndoDriver,
  {
    readonly capture: (
      input: GitWorkbenchUndoCaptureInput,
    ) => Effect.Effect<GitWorkbenchUndoSnapshot, GitWorkbenchUndoError>;
    readonly restore: (
      snapshot: GitWorkbenchUndoSnapshot,
    ) => Effect.Effect<void, GitWorkbenchUndoError>;
    readonly remove: (
      snapshot: GitWorkbenchUndoSnapshot,
    ) => Effect.Effect<void, GitWorkbenchUndoError>;
  }
>()("t3/git-workbench/GitWorkbenchUndoDriver") {}

const FULL_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const UNDO_IDENTITY_ENV: NodeJS.ProcessEnv = {
  GIT_AUTHOR_NAME: "T3 Code",
  GIT_AUTHOR_EMAIL: "t3code@users.noreply.github.com",
  GIT_COMMITTER_NAME: "T3 Code",
  GIT_COMMITTER_EMAIL: "t3code@users.noreply.github.com",
};

function toError(
  operation: GitWorkbenchUndoError["operation"],
  cwd: string,
  detail: string,
  cause?: unknown,
) {
  return new GitWorkbenchUndoError({ operation, cwd, detail, ...(cause ? { cause } : {}) });
}

export const make = Effect.gen(function* () {
  const commandRunner = yield* GitWorkbenchOperationsDriver;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const run = (
    operation: GitWorkbenchUndoError["operation"],
    cwd: string,
    args: readonly string[],
    options: { readonly env?: NodeJS.ProcessEnv } = {},
  ) =>
    commandRunner
      .run({
        operation: `GitWorkbenchUndoDriver.${operation}`,
        cwd,
        args,
        allowNonZeroExit: true,
        ...(options.env ? { env: options.env } : {}),
      })
      .pipe(
        Effect.mapError((cause) => toError(operation, cwd, "Git command could not run.", cause)),
      );

  const required = Effect.fn("GitWorkbenchUndoDriver.required")(function* (
    operation: GitWorkbenchUndoError["operation"],
    cwd: string,
    args: readonly string[],
    options: { readonly env?: NodeJS.ProcessEnv } = {},
  ) {
    const result = yield* run(operation, cwd, args, options);
    if (result.exitCode === 0) return result.stdout.trim();
    return yield* toError(operation, cwd, result.stderr.trim() || "Git command failed.");
  });

  const verifySnapshotObject = Effect.fn("GitWorkbenchUndoDriver.verifySnapshotObject")(function* (
    snapshot: GitWorkbenchUndoSnapshot,
    revision: string,
    expectedOid: string,
  ) {
    const result = yield* run("restore", snapshot.worktreeRoot, [
      "rev-parse",
      "--verify",
      revision,
    ]);
    const actualOid = result.stdout.trim();
    if (result.exitCode === 0 && actualOid === expectedOid) return;
    return yield* toError(
      "restore",
      snapshot.cwd,
      "Undo snapshot refs do not match this repository. No files were changed.",
    );
  });

  const deleteRefs = (snapshot: GitWorkbenchUndoSnapshot) =>
    Effect.forEach(
      ["head", "index", "worktree"],
      (suffix) =>
        run("delete", snapshot.worktreeRoot, [
          "update-ref",
          "-d",
          `${snapshot.refNamespace}/${suffix}`,
        ]),
      { discard: true },
    ).pipe(
      Effect.mapError((cause) =>
        cause instanceof GitWorkbenchUndoError
          ? cause
          : toError("delete", snapshot.cwd, "Failed to delete undo refs.", cause),
      ),
    );

  return GitWorkbenchUndoDriver.of({
    capture: (input) =>
      Effect.gen(function* () {
        const root = yield* required("capture", input.cwd, ["rev-parse", "--show-toplevel"]);
        const commonDirResult = yield* required("capture", root, ["rev-parse", "--git-common-dir"]);
        const commonDir = path.isAbsolute(commonDirResult)
          ? commonDirResult
          : path.resolve(root, commonDirResult);
        const headResult = yield* run("capture", root, ["rev-parse", "--verify", "HEAD"]);
        const headOid = headResult.exitCode === 0 ? headResult.stdout.trim() : null;
        if (headOid && !FULL_OBJECT_ID.test(headOid)) {
          return yield* toError("capture", root, "Git returned an invalid HEAD object id.");
        }

        const headRefResult = yield* run("capture", root, ["symbolic-ref", "--quiet", "HEAD"]);
        const headRef = headRefResult.exitCode === 0 ? headRefResult.stdout.trim() : null;
        const indexTreeOid = yield* required("capture", root, ["write-tree"]);
        if (!FULL_OBJECT_ID.test(indexTreeOid)) {
          return yield* toError("capture", root, "Git returned an invalid index tree object id.");
        }

        const tempIndexPath = path.join(commonDir, `t3-workbench-undo-${input.id}.index`);
        const tempIndexEnv = { ...UNDO_IDENTITY_ENV, GIT_INDEX_FILE: tempIndexPath };
        const cleanupIndex = fileSystem.remove(tempIndexPath, { force: true }).pipe(Effect.ignore);
        const cleanupRefs = deleteRefs({
          ...input,
          worktreeRoot: root,
          headRef,
          headOid,
          indexTreeOid,
          worktreeCommitOid: headOid ?? indexTreeOid,
        }).pipe(Effect.ignore);

        return yield* Effect.gen(function* () {
          yield* required("capture", root, ["read-tree", "--empty"], { env: tempIndexEnv });
          yield* required("capture", root, ["add", "-A", "--", "."], { env: tempIndexEnv });
          const worktreeTreeOid = yield* required("capture", root, ["write-tree"], {
            env: tempIndexEnv,
          });
          const parentArgs = headOid ? ["-p", headOid] : [];
          const indexCommitOid = yield* required(
            "capture",
            root,
            ["commit-tree", indexTreeOid, ...parentArgs, "-m", `t3 undo index ${input.id}`],
            { env: UNDO_IDENTITY_ENV },
          );
          const worktreeCommitOid = yield* required(
            "capture",
            root,
            ["commit-tree", worktreeTreeOid, ...parentArgs, "-m", `t3 undo worktree ${input.id}`],
            { env: UNDO_IDENTITY_ENV },
          );

          yield* required("capture", root, [
            "update-ref",
            `${input.refNamespace}/index`,
            indexCommitOid,
          ]);
          yield* required("capture", root, [
            "update-ref",
            `${input.refNamespace}/worktree`,
            worktreeCommitOid,
          ]);
          if (headOid) {
            yield* required("capture", root, ["update-ref", `${input.refNamespace}/head`, headOid]);
          }

          return {
            ...input,
            worktreeRoot: root,
            headRef,
            headOid,
            indexTreeOid,
            worktreeCommitOid,
          } satisfies GitWorkbenchUndoSnapshot;
        }).pipe(
          Effect.onError(() => cleanupRefs),
          Effect.ensuring(cleanupIndex),
        );
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof GitWorkbenchUndoError
            ? cause
            : toError("capture", input.cwd, "Failed to capture an undo snapshot.", cause),
        ),
      ),

    restore: (snapshot) =>
      Effect.gen(function* () {
        yield* verifySnapshotObject(
          snapshot,
          `${snapshot.refNamespace}/worktree^{commit}`,
          snapshot.worktreeCommitOid,
        );
        yield* verifySnapshotObject(
          snapshot,
          `${snapshot.refNamespace}/index^{tree}`,
          snapshot.indexTreeOid,
        );
        if (snapshot.headOid) {
          yield* verifySnapshotObject(
            snapshot,
            `${snapshot.refNamespace}/head^{commit}`,
            snapshot.headOid,
          );
        }

        const currentHead = yield* run("restore", snapshot.worktreeRoot, [
          "rev-parse",
          "--verify",
          "HEAD",
        ]);
        if (currentHead.exitCode === 0) {
          yield* required("restore", snapshot.worktreeRoot, [
            "update-ref",
            "--no-deref",
            "HEAD",
            currentHead.stdout.trim(),
          ]);
        }
        yield* required("restore", snapshot.worktreeRoot, ["clean", "-fd", "--", "."]);
        yield* required("restore", snapshot.worktreeRoot, [
          "reset",
          "--hard",
          snapshot.worktreeCommitOid,
        ]);

        if (snapshot.headRef) {
          yield* required("restore", snapshot.worktreeRoot, [
            "symbolic-ref",
            "HEAD",
            snapshot.headRef,
          ]);
          if (snapshot.headOid) {
            yield* required("restore", snapshot.worktreeRoot, [
              "update-ref",
              snapshot.headRef,
              snapshot.headOid,
            ]);
          } else {
            yield* run("restore", snapshot.worktreeRoot, ["update-ref", "-d", snapshot.headRef]);
          }
        } else if (snapshot.headOid) {
          yield* required("restore", snapshot.worktreeRoot, [
            "update-ref",
            "--no-deref",
            "HEAD",
            snapshot.headOid,
          ]);
        } else {
          return yield* toError(
            "restore",
            snapshot.cwd,
            "Undo snapshot has neither a branch ref nor a detached HEAD object.",
          );
        }

        yield* required("restore", snapshot.worktreeRoot, ["read-tree", snapshot.indexTreeOid]);
      }).pipe(
        Effect.mapError((cause) =>
          cause instanceof GitWorkbenchUndoError
            ? cause
            : toError("restore", snapshot.cwd, "Failed to restore an undo snapshot.", cause),
        ),
      ),

    remove: deleteRefs,
  });
});

export const layer = Layer.effect(GitWorkbenchUndoDriver, make);
