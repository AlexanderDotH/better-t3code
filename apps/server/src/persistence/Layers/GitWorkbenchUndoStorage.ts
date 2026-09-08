import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  GitWorkbenchUndoStorage,
  GitWorkbenchUndoStorageError,
} from "../../git-workbench/GitWorkbenchUndoStorage.ts";

const UndoReason = Schema.Literals([
  "before_discard",
  "before_mixed_reset",
  "before_hard_reset",
  "before_rebase",
  "before_cherry_pick",
  "before_revert",
  "before_branch_switch",
  "before_restore",
  "manual",
]);

const UndoSnapshotRow = Schema.Struct({
  id: Schema.NonEmptyString,
  cwd: Schema.NonEmptyString,
  worktreeRoot: Schema.NonEmptyString,
  reason: UndoReason,
  createdAt: Schema.Int,
  expiresAt: Schema.Int,
  headRef: Schema.NullOr(Schema.String),
  headOid: Schema.NullOr(Schema.String),
  indexTreeOid: Schema.NonEmptyString,
  worktreeCommitOid: Schema.NonEmptyString,
  refNamespace: Schema.NonEmptyString,
  capturedStateToken: Schema.NullOr(Schema.String),
});

const GetInput = Schema.Struct({
  cwd: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
});

const ListInput = Schema.Struct({ cwd: Schema.NonEmptyString });

function storageError(operation: GitWorkbenchUndoStorageError["operation"]) {
  return (cause: unknown) =>
    new GitWorkbenchUndoStorageError({
      operation,
      detail: `Undo snapshot persistence failed in ${operation}.`,
      cause,
    });
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const insertRow = SqlSchema.void({
    Request: UndoSnapshotRow,
    execute: (snapshot) => sql`
      INSERT INTO git_workbench_undo_snapshots (
        id,
        cwd,
        worktree_root,
        reason,
        branch_ref,
        head_oid,
        base_ref_namespace,
        index_tree_oid,
        worktree_commit_oid,
        captured_state_token,
        metadata_json,
        created_at,
        expires_at
      ) VALUES (
        ${snapshot.id},
        ${snapshot.cwd},
        ${snapshot.worktreeRoot},
        ${snapshot.reason},
        ${snapshot.headRef},
        ${snapshot.headOid},
        ${snapshot.refNamespace},
        ${snapshot.indexTreeOid},
        ${snapshot.worktreeCommitOid},
        ${snapshot.capturedStateToken},
        '{}',
        ${snapshot.createdAt},
        ${snapshot.expiresAt}
      )
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetInput,
    Result: UndoSnapshotRow,
    execute: ({ cwd, id }) => sql`
      SELECT
        id,
        cwd,
        worktree_root AS "worktreeRoot",
        reason,
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        branch_ref AS "headRef",
        head_oid AS "headOid",
        index_tree_oid AS "indexTreeOid",
        worktree_commit_oid AS "worktreeCommitOid",
        base_ref_namespace AS "refNamespace",
        captured_state_token AS "capturedStateToken"
      FROM git_workbench_undo_snapshots
      WHERE cwd = ${cwd} AND id = ${id}
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListInput,
    Result: UndoSnapshotRow,
    execute: ({ cwd }) => sql`
      SELECT
        id,
        cwd,
        worktree_root AS "worktreeRoot",
        reason,
        created_at AS "createdAt",
        expires_at AS "expiresAt",
        branch_ref AS "headRef",
        head_oid AS "headOid",
        index_tree_oid AS "indexTreeOid",
        worktree_commit_oid AS "worktreeCommitOid",
        base_ref_namespace AS "refNamespace",
        captured_state_token AS "capturedStateToken"
      FROM git_workbench_undo_snapshots
      WHERE cwd = ${cwd}
      ORDER BY created_at DESC, id ASC
    `,
  });

  const removeRow = SqlSchema.void({
    Request: GetInput,
    execute: ({ cwd, id }) => sql`
      DELETE FROM git_workbench_undo_snapshots
      WHERE cwd = ${cwd} AND id = ${id}
    `,
  });

  return GitWorkbenchUndoStorage.of({
    insert: (snapshot) => insertRow(snapshot).pipe(Effect.mapError(storageError("insert"))),
    get: (cwd, id) =>
      getRow({ cwd, id }).pipe(
        Effect.map((result) => (result._tag === "Some" ? result.value : null)),
        Effect.mapError(storageError("get")),
      ),
    list: (cwd) => listRows({ cwd }).pipe(Effect.mapError(storageError("list"))),
    remove: (cwd, id) => removeRow({ cwd, id }).pipe(Effect.mapError(storageError("remove"))),
  });
});

export const GitWorkbenchUndoStorageLive = Layer.effect(GitWorkbenchUndoStorage, make);
