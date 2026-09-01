// @effect-diagnostics nodeBuiltinImport:off
/**
 * WorkspaceFileSystem - Effect service contract for workspace file mutations.
 *
 * Owns workspace-root-relative file read/write operations and their associated
 * safety checks and cache invalidation hooks.
 *
 * @module WorkspaceFileSystem
 */
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import type {
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
  WorkspaceEditAction,
  WorkspaceEditInput,
  WorkspaceEditResult,
} from "@t3tools/contracts";
import {
  WORKSPACE_EDIT_MAX_BATCH_WORKING_SET_BYTES,
  WORKSPACE_EDIT_MAX_CHANGES,
  WORKSPACE_EDIT_MAX_EDITS,
  WORKSPACE_EDIT_MAX_RESULTING_FILE_BYTES,
  WorkspaceEditError,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";

import * as WorkspaceEntries from "./WorkspaceEntries.ts";
import * as WorkspacePaths from "./WorkspacePaths.ts";
import { applyWorkspaceTextEdits } from "./WorkspaceTextEdit.ts";

const PROJECT_READ_FILE_MAX_BYTES = 1024 * 1024;

export class WorkspaceFileSystemOperationError extends Schema.TaggedErrorClass<WorkspaceFileSystemOperationError>()(
  "WorkspaceFileSystemOperationError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
    operationPath: Schema.String,
    operation: Schema.Literals([
      "realpath-workspace-root",
      "realpath-target",
      "open",
      "stat",
      "read",
      "close",
      "make-directory",
      "write-file",
    ]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Workspace file operation '${this.operation}' failed at '${this.operationPath}' for resolved path '${this.resolvedPath}' (requested as '${this.relativePath}' in '${this.workspaceRoot}').`;
  }
}

export class WorkspaceFilePathEscapeError extends Schema.TaggedErrorClass<WorkspaceFilePathEscapeError>()(
  "WorkspaceFilePathEscapeError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedWorkspaceRoot: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' resolves outside workspace root '${this.workspaceRoot}': ${this.resolvedPath}`;
  }
}

export class WorkspacePathNotFileError extends Schema.TaggedErrorClass<WorkspacePathNotFileError>()(
  "WorkspacePathNotFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace path '${this.relativePath}' in '${this.workspaceRoot}' is not a file: ${this.resolvedPath}`;
  }
}

export class WorkspaceBinaryFileError extends Schema.TaggedErrorClass<WorkspaceBinaryFileError>()(
  "WorkspaceBinaryFileError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    resolvedPath: Schema.String,
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' in '${this.workspaceRoot}' is binary and cannot be previewed as text.`;
  }
}

export class WorkspaceFileRevisionConflictError extends Schema.TaggedErrorClass<WorkspaceFileRevisionConflictError>()(
  "WorkspaceFileRevisionConflictError",
  {
    workspaceRoot: Schema.String,
    relativePath: Schema.String,
    expectedRevision: Schema.String,
    actualRevision: Schema.NullOr(Schema.String),
  },
) {
  override get message(): string {
    return `Workspace file '${this.relativePath}' changed before it could be saved.`;
  }
}

const isWorkspaceFileRevisionConflictError = Schema.is(WorkspaceFileRevisionConflictError);
const isWorkspaceEditError = Schema.is(WorkspaceEditError);

export const WorkspaceFileSystemError = Schema.Union([
  WorkspaceFileSystemOperationError,
  WorkspaceFilePathEscapeError,
  WorkspacePathNotFileError,
  WorkspaceBinaryFileError,
]);
export type WorkspaceFileSystemError = typeof WorkspaceFileSystemError.Type;

function contentRevision(bytes: Uint8Array, byteLength: number): string {
  return `sha256:${NodeCrypto.createHash("sha256")
    .update(String(byteLength))
    .update("\0")
    .update(bytes)
    .digest("hex")}`;
}

async function readBoundedRevision(filePath: string): Promise<string> {
  const handle = await NodeFSP.open(filePath, "r");
  try {
    const stat = await handle.stat();
    const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return contentRevision(buffer.subarray(0, bytesRead), stat.size);
  } finally {
    await handle.close();
  }
}

type WorkspaceEditSnapshot =
  | {
      readonly exists: false;
      readonly contents: undefined;
      readonly byteLength: 0;
      readonly revision: null;
      readonly mode: 0o666;
    }
  | {
      readonly exists: true;
      readonly contents: string;
      readonly byteLength: number;
      readonly revision: string;
      readonly mode: number;
    };

type WorkspaceEditTarget = {
  readonly changeIndex: number;
  readonly path: string;
  readonly absolutePath: string;
  readonly change: WorkspaceEditInput["changes"][number];
};

type PlannedWorkspaceEdit = WorkspaceEditTarget & {
  readonly snapshot: WorkspaceEditSnapshot;
  readonly contents: string | undefined;
  readonly action: WorkspaceEditAction;
  readonly revision: string | undefined;
  stagePath?: string | undefined;
};

function nodeErrorCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

/** Service tag for workspace file operations. */
export class WorkspaceFileSystem extends Context.Service<
  WorkspaceFileSystem,
  {
    /** Read a UTF-8 text file relative to the workspace root. */
    readonly readFile: (
      input: ProjectReadFileInput,
    ) => Effect.Effect<
      ProjectReadFileResult,
      WorkspaceFileSystemError | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /**
     * Write a file relative to the workspace root.
     *
     * Creates parent directories as needed and rejects paths that escape the
     * workspace root.
     */
    readonly writeFile: (
      input: ProjectWriteFileInput,
    ) => Effect.Effect<
      ProjectWriteFileResult,
      | WorkspaceFileSystemError
      | WorkspaceFileRevisionConflictError
      | WorkspacePaths.WorkspacePathOutsideRootError
    >;
    /** Apply one validated, workspace-scoped batch of UTF-8 text file changes. */
    readonly editFiles: (request: {
      readonly workspaceRoot: string;
      readonly input: WorkspaceEditInput;
    }) => Effect.Effect<WorkspaceEditResult, WorkspaceEditError>;
  }
>()("t3/workspace/WorkspaceFileSystem") {}

export const makeWithFileRename = (renameFile: typeof NodeFSP.rename) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const workspacePaths = yield* WorkspacePaths.WorkspacePaths;
    const workspaceEntries = yield* WorkspaceEntries.WorkspaceEntries;

    // ponytail: locks live for the service lifetime; prune them only if workspace churn becomes real.
    const editLocks = new Map<string, Semaphore.Semaphore>();
    const editLockFor = (workspaceRoot: string): Semaphore.Semaphore => {
      const key = path.resolve(workspaceRoot);
      const existing = editLocks.get(key);
      if (existing) return existing;
      const created = Semaphore.makeUnsafe(1);
      editLocks.set(key, created);
      return created;
    };

    const targetError = (
      target: WorkspaceEditTarget,
      reason: WorkspaceEditError["reason"],
      fields: {
        readonly edit_index?: number | undefined;
        readonly expected_revision?: string | undefined;
        readonly actual_revision?: string | null | undefined;
        readonly uncertain_paths?: ReadonlyArray<string> | undefined;
      } = {},
    ): WorkspaceEditError =>
      new WorkspaceEditError({
        reason,
        path: target.path,
        change_index: target.changeIndex,
        ...(fields.edit_index === undefined ? {} : { edit_index: fields.edit_index }),
        ...(fields.expected_revision === undefined
          ? {}
          : { expected_revision: fields.expected_revision }),
        ...(fields.actual_revision === undefined
          ? {}
          : { actual_revision: fields.actual_revision }),
        ...(fields.uncertain_paths === undefined
          ? {}
          : { uncertain_paths: [...fields.uncertain_paths] }),
      });

    const isWithinRealRoot = (realWorkspaceRoot: string, candidate: string): boolean => {
      const relative = path.relative(realWorkspaceRoot, candidate);
      return !(
        relative.startsWith(`..${path.sep}`) ||
        relative === ".." ||
        path.isAbsolute(relative)
      );
    };

    const assertSafeParent = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      target: WorkspaceEditTarget,
    ): Promise<void> => {
      const absoluteRoot = path.resolve(workspaceRoot);
      const parent = path.dirname(target.absolutePath);
      const relativeParent = path.relative(absoluteRoot, parent);
      const segments = relativeParent.length === 0 ? [] : relativeParent.split(path.sep);
      let current = absoluteRoot;
      let lastExisting = absoluteRoot;
      for (const segment of segments) {
        current = path.join(current, segment);
        try {
          const stat = await NodeFSP.lstat(current);
          if (stat.isSymbolicLink()) throw targetError(target, "symlink");
          if (!stat.isDirectory()) throw targetError(target, "not_file");
          lastExisting = current;
        } catch (cause) {
          if (isWorkspaceEditError(cause)) throw cause;
          if (nodeErrorCode(cause) === "ENOENT") break;
          throw targetError(target, "commit_failed");
        }
      }

      let realExistingParent: string;
      try {
        realExistingParent = await NodeFSP.realpath(lastExisting);
      } catch {
        throw targetError(target, "commit_failed");
      }
      if (!isWithinRealRoot(realWorkspaceRoot, realExistingParent)) {
        throw targetError(target, "path_outside_root");
      }
    };

    const readEditSnapshot = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      target: WorkspaceEditTarget,
    ): Promise<WorkspaceEditSnapshot> => {
      await assertSafeParent(workspaceRoot, realWorkspaceRoot, target);
      let stat;
      try {
        stat = await NodeFSP.lstat(target.absolutePath);
      } catch (cause) {
        if (nodeErrorCode(cause) === "ENOENT") {
          return {
            exists: false,
            contents: undefined,
            byteLength: 0,
            revision: null,
            mode: 0o666,
          };
        }
        throw targetError(target, "commit_failed");
      }
      if (stat.isSymbolicLink()) throw targetError(target, "symlink");
      if (!stat.isFile()) throw targetError(target, "not_file");
      if (stat.size > WORKSPACE_EDIT_MAX_RESULTING_FILE_BYTES) {
        throw targetError(target, "file_too_large");
      }

      let realTarget: string;
      let bytes: Buffer;
      try {
        realTarget = await NodeFSP.realpath(target.absolutePath);
        bytes = await NodeFSP.readFile(target.absolutePath);
      } catch {
        throw targetError(target, "commit_failed");
      }
      if (!isWithinRealRoot(realWorkspaceRoot, realTarget)) {
        throw targetError(target, "path_outside_root");
      }
      if (bytes.byteLength > WORKSPACE_EDIT_MAX_RESULTING_FILE_BYTES) {
        throw targetError(target, "file_too_large");
      }
      if (bytes.includes(0)) throw targetError(target, "binary");

      let contents: string;
      try {
        contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw targetError(target, "invalid_utf8");
      }
      return {
        exists: true,
        contents,
        byteLength: bytes.byteLength,
        revision: contentRevision(bytes, bytes.byteLength),
        mode: stat.mode & 0o777,
      };
    };

    const makeStageFile = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      target: WorkspaceEditTarget,
      contents: string,
      mode: number,
      label: string,
    ): Promise<string> => {
      const parent = path.dirname(target.absolutePath);
      try {
        await NodeFSP.mkdir(parent, { recursive: true });
      } catch {
        throw targetError(target, "commit_failed");
      }
      await assertSafeParent(workspaceRoot, realWorkspaceRoot, target);
      const stagePath = path.join(
        parent,
        `.t3-${label}-${NodeCrypto.randomUUID()}-${path.basename(target.absolutePath)}`,
      );
      try {
        await NodeFSP.writeFile(stagePath, contents, { flag: "wx", mode });
        const handle = await NodeFSP.open(stagePath, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        return stagePath;
      } catch (cause) {
        await NodeFSP.rm(stagePath, { force: true }).catch(() => undefined);
        if (isWorkspaceEditError(cause)) throw cause;
        throw targetError(target, "commit_failed");
      }
    };

    const actionFor = (
      snapshot: WorkspaceEditSnapshot,
      contents: string | undefined,
    ): WorkspaceEditAction => {
      if (!snapshot.exists && contents !== undefined) return "created";
      if (snapshot.exists && contents === undefined) return "deleted";
      if (snapshot.contents === contents) return "unchanged";
      return "updated";
    };

    const prepareWorkspaceEdits = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      targets: ReadonlyArray<WorkspaceEditTarget>,
    ): Promise<ReadonlyArray<PlannedWorkspaceEdit>> => {
      let workingSetBytes = 0;
      const planned: PlannedWorkspaceEdit[] = [];
      for (const target of targets) {
        const snapshot = await readEditSnapshot(workspaceRoot, realWorkspaceRoot, target);
        if (
          target.change.expected_revision !== undefined &&
          snapshot.revision !== target.change.expected_revision
        ) {
          throw targetError(target, "revision_conflict", {
            expected_revision: target.change.expected_revision,
            actual_revision: snapshot.revision,
          });
        }

        const applied = applyWorkspaceTextEdits(snapshot.contents, target.change.edits);
        if (!applied.ok) {
          throw targetError(target, applied.reason, { edit_index: applied.editIndex });
        }
        const resultingBytes =
          applied.contents === undefined ? 0 : Buffer.byteLength(applied.contents, "utf-8");
        if (applied.contents?.includes("\0")) throw targetError(target, "binary");
        if (resultingBytes > WORKSPACE_EDIT_MAX_RESULTING_FILE_BYTES) {
          throw targetError(target, "file_too_large");
        }
        workingSetBytes += Math.max(snapshot.byteLength, resultingBytes);
        if (workingSetBytes > WORKSPACE_EDIT_MAX_BATCH_WORKING_SET_BYTES) {
          throw targetError(target, "batch_too_large");
        }
        planned.push({
          ...target,
          snapshot,
          contents: applied.contents,
          action: actionFor(snapshot, applied.contents),
          revision:
            applied.contents === undefined
              ? undefined
              : contentRevision(Buffer.from(applied.contents, "utf-8"), resultingBytes),
        });
      }
      return planned;
    };

    const verifyOriginalSnapshot = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      planned: PlannedWorkspaceEdit,
    ): Promise<void> => {
      const current = await readEditSnapshot(workspaceRoot, realWorkspaceRoot, planned);
      if (current.revision === planned.snapshot.revision) return;
      throw targetError(planned, "revision_conflict", {
        ...(planned.change.expected_revision === undefined
          ? {}
          : { expected_revision: planned.change.expected_revision }),
        actual_revision: current.revision,
      });
    };

    const restoreSnapshot = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      planned: PlannedWorkspaceEdit,
    ): Promise<void> => {
      if (!planned.snapshot.exists) {
        await NodeFSP.unlink(planned.absolutePath).catch((cause) => {
          if (nodeErrorCode(cause) !== "ENOENT") throw cause;
        });
        return;
      }
      const stagePath = await makeStageFile(
        workspaceRoot,
        realWorkspaceRoot,
        planned,
        planned.snapshot.contents,
        planned.snapshot.mode,
        "rollback",
      );
      try {
        await renameFile(stagePath, planned.absolutePath);
      } finally {
        await NodeFSP.rm(stagePath, { force: true }).catch(() => undefined);
      }
    };

    const rollbackWorkspaceEdits = async (
      workspaceRoot: string,
      realWorkspaceRoot: string,
      committed: ReadonlyArray<PlannedWorkspaceEdit>,
    ): Promise<ReadonlyArray<string>> => {
      const uncertain = new Set<string>();
      for (const planned of committed.toReversed()) {
        try {
          const current = await readEditSnapshot(workspaceRoot, realWorkspaceRoot, planned);
          if (current.revision !== (planned.revision ?? null)) {
            uncertain.add(planned.path);
            continue;
          }
          await restoreSnapshot(workspaceRoot, realWorkspaceRoot, planned);
          const restored = await readEditSnapshot(workspaceRoot, realWorkspaceRoot, planned);
          if (restored.revision !== planned.snapshot.revision) uncertain.add(planned.path);
        } catch {
          uncertain.add(planned.path);
        }
      }
      return [...uncertain];
    };

    const cleanupStages = async (planned: ReadonlyArray<PlannedWorkspaceEdit>): Promise<void> => {
      await Promise.all(
        planned.map((change) =>
          change.stagePath
            ? NodeFSP.rm(change.stagePath, { force: true }).catch(() => undefined)
            : Promise.resolve(),
        ),
      );
    };

    const runWorkspaceEditTransaction = async (
      workspaceRoot: string,
      targets: ReadonlyArray<WorkspaceEditTarget>,
      state: { commitStarted: boolean },
    ): Promise<WorkspaceEditResult> => {
      let realWorkspaceRoot: string;
      try {
        realWorkspaceRoot = await NodeFSP.realpath(workspaceRoot);
      } catch (cause) {
        throw new WorkspaceEditError({
          reason:
            nodeErrorCode(cause) === "ENOENT"
              ? "workspace_root_not_found"
              : "workspace_root_unreadable",
        });
      }
      try {
        if (!(await NodeFSP.stat(realWorkspaceRoot)).isDirectory()) {
          throw new WorkspaceEditError({ reason: "workspace_root_not_directory" });
        }
      } catch (cause) {
        if (isWorkspaceEditError(cause)) throw cause;
        throw new WorkspaceEditError({ reason: "workspace_root_unreadable" });
      }

      const planned = [...(await prepareWorkspaceEdits(workspaceRoot, realWorkspaceRoot, targets))];
      let active = planned[0];
      try {
        for (const change of planned) {
          active = change;
          if (change.contents === undefined || change.action === "unchanged") continue;
          change.stagePath = await makeStageFile(
            workspaceRoot,
            realWorkspaceRoot,
            change,
            change.contents,
            change.snapshot.mode,
            "edit",
          );
        }

        const committed: PlannedWorkspaceEdit[] = [];
        try {
          for (const change of planned) {
            active = change;
            if (change.action === "unchanged") continue;
            await verifyOriginalSnapshot(workspaceRoot, realWorkspaceRoot, change);
            state.commitStarted = true;
            if (change.contents === undefined) {
              await NodeFSP.unlink(change.absolutePath);
            } else {
              const stagePath = change.stagePath;
              if (!stagePath) throw targetError(change, "commit_failed");
              await renameFile(stagePath, change.absolutePath);
              change.stagePath = undefined;
            }
            committed.push(change);
          }
        } catch (cause) {
          const uncertainPaths = await rollbackWorkspaceEdits(
            workspaceRoot,
            realWorkspaceRoot,
            committed,
          );
          if (uncertainPaths.length > 0) {
            throw targetError(active ?? targets[0]!, "rollback_incomplete", {
              uncertain_paths: uncertainPaths,
            });
          }
          if (isWorkspaceEditError(cause)) throw cause;
          throw targetError(active ?? targets[0]!, "commit_failed");
        }

        return {
          changes: planned.map((change) => ({
            path: change.path,
            action: change.action,
            edit_count: change.change.edits.length,
            ...(change.revision === undefined ? {} : { revision: change.revision }),
          })),
        };
      } catch (cause) {
        if (isWorkspaceEditError(cause)) throw cause;
        throw targetError(active ?? targets[0]!, "commit_failed");
      } finally {
        await cleanupStages(planned);
      }
    };

    const readFile: WorkspaceFileSystem["Service"]["readFile"] = Effect.fn(
      "WorkspaceFileSystem.readFile",
    )(function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      const realWorkspaceRoot = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(input.cwd),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: input.cwd,
            operation: "realpath-workspace-root",
            cause,
          }),
      });
      const realTargetPath = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(target.absolutePath),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: target.absolutePath,
            operation: "realpath-target",
            cause,
          }),
      });
      const relativeRealPath = path.relative(realWorkspaceRoot, realTargetPath);
      if (
        relativeRealPath.startsWith(`..${path.sep}`) ||
        relativeRealPath === ".." ||
        path.isAbsolute(relativeRealPath)
      ) {
        return yield* new WorkspaceFilePathEscapeError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedWorkspaceRoot: realWorkspaceRoot,
          resolvedPath: realTargetPath,
        });
      }

      return yield* Effect.acquireUseRelease(
        Effect.tryPromise({
          try: () => NodeFSP.open(realTargetPath, "r"),
          catch: (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: realTargetPath,
              operationPath: realTargetPath,
              operation: "open",
              cause,
            }),
        }),
        (handle) =>
          Effect.gen(function* () {
            const stat = yield* Effect.tryPromise({
              try: () => handle.stat(),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "stat",
                  cause,
                }),
            });
            if (!stat.isFile()) {
              return yield* new WorkspacePathNotFileError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
              });
            }

            const bytesToRead = Math.min(stat.size, PROJECT_READ_FILE_MAX_BYTES);
            const buffer = Buffer.alloc(bytesToRead);
            const { bytesRead } = yield* Effect.tryPromise({
              try: () => handle.read(buffer, 0, bytesToRead, 0),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: realTargetPath,
                  operationPath: realTargetPath,
                  operation: "read",
                  cause,
                }),
            });
            const fileBytes = buffer.subarray(0, bytesRead);
            if (fileBytes.includes(0)) {
              return yield* new WorkspaceBinaryFileError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
              });
            }

            return {
              relativePath: target.relativePath,
              contents: new TextDecoder("utf-8").decode(fileBytes),
              byteLength: stat.size,
              truncated: stat.size > PROJECT_READ_FILE_MAX_BYTES,
              revision: contentRevision(fileBytes, stat.size),
            };
          }),
        (handle) =>
          Effect.tryPromise({
            try: () => handle.close(),
            catch: (cause) =>
              new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: realTargetPath,
                operationPath: realTargetPath,
                operation: "close",
                cause,
              }),
          }),
      );
    });

    const writeFile: WorkspaceFileSystem["Service"]["writeFile"] = Effect.fn(
      "WorkspaceFileSystem.writeFile",
    )(function* (input) {
      const target = yield* workspacePaths.resolveRelativePathWithinRoot({
        workspaceRoot: input.cwd,
        relativePath: input.relativePath,
      });

      const realWorkspaceRoot = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(input.cwd),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: input.cwd,
            operation: "realpath-workspace-root",
            cause,
          }),
      });
      const requestedParent = path.dirname(target.absolutePath);
      yield* fileSystem.makeDirectory(requestedParent, { recursive: true }).pipe(
        Effect.mapError(
          (cause) =>
            new WorkspaceFileSystemOperationError({
              workspaceRoot: input.cwd,
              relativePath: input.relativePath,
              resolvedPath: target.absolutePath,
              operationPath: requestedParent,
              operation: "make-directory",
              cause,
            }),
        ),
      );
      const realParent = yield* Effect.tryPromise({
        try: () => NodeFSP.realpath(requestedParent),
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: target.absolutePath,
            operationPath: requestedParent,
            operation: "realpath-target",
            cause,
          }),
      });
      const relativeRealParent = path.relative(realWorkspaceRoot, realParent);
      if (
        relativeRealParent.startsWith(`..${path.sep}`) ||
        relativeRealParent === ".." ||
        path.isAbsolute(relativeRealParent)
      ) {
        return yield* new WorkspaceFilePathEscapeError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedWorkspaceRoot: realWorkspaceRoot,
          resolvedPath: realParent,
        });
      }

      const writeTarget = path.join(realParent, path.basename(target.absolutePath));
      const existingStat = yield* Effect.tryPromise({
        try: async () => {
          try {
            return await NodeFSP.lstat(writeTarget);
          } catch (cause) {
            if (
              typeof cause === "object" &&
              cause !== null &&
              "code" in cause &&
              cause.code === "ENOENT"
            ) {
              return null;
            }
            throw cause;
          }
        },
        catch: (cause) =>
          new WorkspaceFileSystemOperationError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            resolvedPath: writeTarget,
            operationPath: writeTarget,
            operation: "stat",
            cause,
          }),
      });
      if (existingStat && (!existingStat.isFile() || existingStat.isSymbolicLink())) {
        return yield* new WorkspacePathNotFileError({
          workspaceRoot: input.cwd,
          relativePath: input.relativePath,
          resolvedPath: writeTarget,
        });
      }

      if (input.expectedRevision !== undefined) {
        const actualRevision = existingStat
          ? yield* Effect.tryPromise({
              try: () => readBoundedRevision(writeTarget),
              catch: (cause) =>
                new WorkspaceFileSystemOperationError({
                  workspaceRoot: input.cwd,
                  relativePath: input.relativePath,
                  resolvedPath: writeTarget,
                  operationPath: writeTarget,
                  operation: "read",
                  cause,
                }),
            })
          : null;
        if (actualRevision !== input.expectedRevision) {
          return yield* new WorkspaceFileRevisionConflictError({
            workspaceRoot: input.cwd,
            relativePath: input.relativePath,
            expectedRevision: input.expectedRevision,
            actualRevision,
          });
        }
      }

      const temporaryPath = path.join(
        realParent,
        `.t3-write-${NodeCrypto.randomUUID()}-${path.basename(writeTarget)}`,
      );
      yield* Effect.tryPromise({
        try: async () => {
          await NodeFSP.writeFile(temporaryPath, input.contents, {
            flag: "wx",
            mode: existingStat ? existingStat.mode & 0o777 : 0o666,
          });
          const temporaryHandle = await NodeFSP.open(temporaryPath, "r+");
          try {
            await temporaryHandle.sync();
          } finally {
            await temporaryHandle.close();
          }
          if (input.expectedRevision !== undefined) {
            const currentRevision = existingStat ? await readBoundedRevision(writeTarget) : null;
            if (currentRevision !== input.expectedRevision) {
              throw new WorkspaceFileRevisionConflictError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                expectedRevision: input.expectedRevision,
                actualRevision: currentRevision,
              });
            }
          }
          await renameFile(temporaryPath, writeTarget);
        },
        catch: (cause) =>
          isWorkspaceFileRevisionConflictError(cause)
            ? cause
            : new WorkspaceFileSystemOperationError({
                workspaceRoot: input.cwd,
                relativePath: input.relativePath,
                resolvedPath: writeTarget,
                operationPath: writeTarget,
                operation: "write-file",
                cause,
              }),
      }).pipe(
        Effect.ensuring(
          Effect.promise(() => NodeFSP.rm(temporaryPath, { force: true })).pipe(Effect.ignore),
        ),
      );
      yield* workspaceEntries.invalidate(input.cwd).pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Failed to invalidate workspace search index after file write", {
            cwd: input.cwd,
            cause,
          }),
        ),
      );
      return { relativePath: target.relativePath };
    });

    const editFilesUnlocked: WorkspaceFileSystem["Service"]["editFiles"] = Effect.fn(
      "WorkspaceFileSystem.editFiles",
    )(function* (request) {
      const editCount = request.input.changes.reduce(
        (count, change) => count + change.edits.length,
        0,
      );
      if (
        request.input.changes.length === 0 ||
        request.input.changes.length > WORKSPACE_EDIT_MAX_CHANGES ||
        editCount === 0 ||
        editCount > WORKSPACE_EDIT_MAX_EDITS ||
        new Set(request.input.changes.map((change) => change.path)).size !==
          request.input.changes.length
      ) {
        return yield* new WorkspaceEditError({ reason: "batch_too_large" });
      }

      const targets = yield* Effect.forEach(request.input.changes, (change, changeIndex) =>
        workspacePaths
          .resolveRelativePathWithinRoot({
            workspaceRoot: request.workspaceRoot,
            relativePath: change.path,
          })
          .pipe(
            Effect.map(
              (resolved): WorkspaceEditTarget => ({
                changeIndex,
                path: resolved.relativePath,
                absolutePath: resolved.absolutePath,
                change,
              }),
            ),
            Effect.mapError(
              () =>
                new WorkspaceEditError({
                  reason: "path_outside_root",
                  path: change.path,
                  change_index: changeIndex,
                }),
            ),
          ),
      );
      const state = { commitStarted: false };
      return yield* Effect.tryPromise({
        try: () => runWorkspaceEditTransaction(request.workspaceRoot, targets, state),
        catch: (cause) =>
          isWorkspaceEditError(cause) ? cause : new WorkspaceEditError({ reason: "commit_failed" }),
      }).pipe(
        Effect.ensuring(
          Effect.suspend(() => {
            if (!state.commitStarted) return Effect.void;
            return workspaceEntries
              .invalidate(request.workspaceRoot)
              .pipe(
                Effect.catch((cause) =>
                  Effect.logWarning(
                    "Failed to invalidate workspace search index after workspace edit",
                    { cwd: request.workspaceRoot, cause },
                  ),
                ),
              );
          }),
        ),
      );
    });

    const editFiles: WorkspaceFileSystem["Service"]["editFiles"] = (request) =>
      editLockFor(request.workspaceRoot).withPermit(editFilesUnlocked(request));

    return WorkspaceFileSystem.of({ readFile, writeFile, editFiles });
  });

export const make = makeWithFileRename(NodeFSP.rename);

export const layer = Layer.effect(WorkspaceFileSystem, make);
