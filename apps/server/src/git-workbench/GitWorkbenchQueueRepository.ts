import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import {
  GitWorkbenchQueuePreconditions,
  GitWorkbenchQueueReviewReason,
  GitWorkbenchQueueScope,
  GitWorkbenchQueueStatus,
  GitWorkbenchQueueWorkflow,
  GitWorkbenchQueuedWorkflow,
  type GitWorkbenchQueueScope as QueueScope,
  type GitWorkbenchQueuedWorkflow as QueuedWorkflow,
} from "./GitWorkbenchQueueModel.ts";

export class GitWorkbenchQueueRepositoryError extends Schema.TaggedErrorClass<GitWorkbenchQueueRepositoryError>()(
  "GitWorkbenchQueueRepositoryError",
  {
    operation: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Git workbench queue persistence failed in ${this.operation}.`;
  }
}

const QueueDbRow = Schema.Struct({
  environmentId: Schema.NonEmptyString,
  worktreeRoot: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  threadId: Schema.NonEmptyString,
  turnId: Schema.NullOr(Schema.NonEmptyString),
  status: GitWorkbenchQueueStatus,
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  workflow: Schema.fromJsonString(GitWorkbenchQueueWorkflow),
  preconditions: Schema.fromJsonString(GitWorkbenchQueuePreconditions),
  needsReviewReasons: Schema.fromJsonString(Schema.Array(GitWorkbenchQueueReviewReason)),
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.NonEmptyString,
  updatedAt: Schema.NonEmptyString,
});
type QueueDbRow = typeof QueueDbRow.Type;

const SaveExpectedInput = Schema.Struct({
  workflow: GitWorkbenchQueuedWorkflow,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

const RemoveExpectedInput = Schema.Struct({
  scope: GitWorkbenchQueueScope,
  expectedRevision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});

const TurnInput = Schema.Struct({
  threadId: Schema.NonEmptyString,
  turnId: Schema.NonEmptyString,
});

const RemovedRow = Schema.Struct({ id: Schema.NonEmptyString });

function fromDbRow(row: QueueDbRow): QueuedWorkflow {
  return {
    id: row.id,
    scope: {
      environmentId: row.environmentId,
      worktreeRoot: row.worktreeRoot,
    },
    threadId: row.threadId,
    turnId: row.turnId,
    status: row.status,
    revision: row.revision,
    workflow: row.workflow,
    preconditions: row.preconditions,
    needsReviewReasons: row.needsReviewReasons,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function persistenceError(operation: string) {
  return (cause: unknown) => new GitWorkbenchQueueRepositoryError({ operation, cause });
}

export interface GitWorkbenchQueueRepositoryShape {
  readonly replace: (
    workflow: QueuedWorkflow,
  ) => Effect.Effect<QueuedWorkflow, GitWorkbenchQueueRepositoryError>;
  readonly get: (
    scope: QueueScope,
  ) => Effect.Effect<Option.Option<QueuedWorkflow>, GitWorkbenchQueueRepositoryError>;
  readonly saveExpected: (
    workflow: QueuedWorkflow,
    expectedRevision: number,
  ) => Effect.Effect<Option.Option<QueuedWorkflow>, GitWorkbenchQueueRepositoryError>;
  readonly removeExpected: (
    scope: QueueScope,
    expectedRevision: number,
  ) => Effect.Effect<boolean, GitWorkbenchQueueRepositoryError>;
  readonly listWaitingForTurn: (
    threadId: string,
    turnId: string,
  ) => Effect.Effect<ReadonlyArray<QueuedWorkflow>, GitWorkbenchQueueRepositoryError>;
  readonly listRecoverable: () => Effect.Effect<
    ReadonlyArray<QueuedWorkflow>,
    GitWorkbenchQueueRepositoryError
  >;
}

export class GitWorkbenchQueueRepository extends Context.Service<
  GitWorkbenchQueueRepository,
  GitWorkbenchQueueRepositoryShape
>()("t3/git-workbench/GitWorkbenchQueueRepository") {}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const replaceRow = SqlSchema.findOne({
    Request: GitWorkbenchQueuedWorkflow,
    Result: QueueDbRow,
    execute: (workflow) => sql`
      INSERT INTO git_workbench_queue (
        environment_id,
        worktree_root,
        workflow_id,
        thread_id,
        turn_id,
        status,
        revision,
        workflow_json,
        preconditions_json,
        review_reasons_json,
        last_error,
        created_at,
        updated_at
      ) VALUES (
        ${workflow.scope.environmentId},
        ${workflow.scope.worktreeRoot},
        ${workflow.id},
        ${workflow.threadId},
        ${workflow.turnId},
        ${workflow.status},
        ${workflow.revision},
        ${JSON.stringify(workflow.workflow)},
        ${JSON.stringify(workflow.preconditions)},
        ${JSON.stringify(workflow.needsReviewReasons)},
        ${workflow.lastError},
        ${workflow.createdAt},
        ${workflow.updatedAt}
      )
      ON CONFLICT (environment_id, worktree_root)
      DO UPDATE SET
        workflow_id = excluded.workflow_id,
        thread_id = excluded.thread_id,
        turn_id = excluded.turn_id,
        status = excluded.status,
        revision = excluded.revision,
        workflow_json = excluded.workflow_json,
        preconditions_json = excluded.preconditions_json,
        review_reasons_json = excluded.review_reasons_json,
        last_error = excluded.last_error,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
      RETURNING
        environment_id AS "environmentId",
        worktree_root AS "worktreeRoot",
        workflow_id AS id,
        thread_id AS "threadId",
        turn_id AS "turnId",
        status,
        revision,
        workflow_json AS workflow,
        preconditions_json AS preconditions,
        review_reasons_json AS "needsReviewReasons",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GitWorkbenchQueueScope,
    Result: QueueDbRow,
    execute: ({ environmentId, worktreeRoot }) => sql`
      SELECT
        environment_id AS "environmentId",
        worktree_root AS "worktreeRoot",
        workflow_id AS id,
        thread_id AS "threadId",
        turn_id AS "turnId",
        status,
        revision,
        workflow_json AS workflow,
        preconditions_json AS preconditions,
        review_reasons_json AS "needsReviewReasons",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM git_workbench_queue
      WHERE environment_id = ${environmentId}
        AND worktree_root = ${worktreeRoot}
    `,
  });

  const saveExpectedRow = SqlSchema.findOneOption({
    Request: SaveExpectedInput,
    Result: QueueDbRow,
    execute: ({ workflow, expectedRevision }) => sql`
      UPDATE git_workbench_queue SET
        status = ${workflow.status},
        revision = ${workflow.revision},
        workflow_json = ${JSON.stringify(workflow.workflow)},
        preconditions_json = ${JSON.stringify(workflow.preconditions)},
        review_reasons_json = ${JSON.stringify(workflow.needsReviewReasons)},
        last_error = ${workflow.lastError},
        updated_at = ${workflow.updatedAt}
      WHERE environment_id = ${workflow.scope.environmentId}
        AND worktree_root = ${workflow.scope.worktreeRoot}
        AND workflow_id = ${workflow.id}
        AND revision = ${expectedRevision}
      RETURNING
        environment_id AS "environmentId",
        worktree_root AS "worktreeRoot",
        workflow_id AS id,
        thread_id AS "threadId",
        turn_id AS "turnId",
        status,
        revision,
        workflow_json AS workflow,
        preconditions_json AS preconditions,
        review_reasons_json AS "needsReviewReasons",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
    `,
  });

  const removeExpectedRow = SqlSchema.findOneOption({
    Request: RemoveExpectedInput,
    Result: RemovedRow,
    execute: ({ scope, expectedRevision }) => sql`
      DELETE FROM git_workbench_queue
      WHERE environment_id = ${scope.environmentId}
        AND worktree_root = ${scope.worktreeRoot}
        AND revision = ${expectedRevision}
      RETURNING workflow_id AS id
    `,
  });

  const listWaitingRows = SqlSchema.findAll({
    Request: TurnInput,
    Result: QueueDbRow,
    execute: ({ threadId, turnId }) => sql`
      SELECT
        environment_id AS "environmentId",
        worktree_root AS "worktreeRoot",
        workflow_id AS id,
        thread_id AS "threadId",
        turn_id AS "turnId",
        status,
        revision,
        workflow_json AS workflow,
        preconditions_json AS preconditions,
        review_reasons_json AS "needsReviewReasons",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM git_workbench_queue
      WHERE thread_id = ${threadId}
        AND turn_id = ${turnId}
        AND status = 'waiting_for_turn'
      ORDER BY created_at ASC, workflow_id ASC
    `,
  });

  const listRecoverableRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: QueueDbRow,
    execute: () => sql`
      SELECT
        environment_id AS "environmentId",
        worktree_root AS "worktreeRoot",
        workflow_id AS id,
        thread_id AS "threadId",
        turn_id AS "turnId",
        status,
        revision,
        workflow_json AS workflow,
        preconditions_json AS preconditions,
        review_reasons_json AS "needsReviewReasons",
        last_error AS "lastError",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM git_workbench_queue
      WHERE status IN ('waiting_for_turn', 'ready', 'running')
      ORDER BY updated_at ASC, workflow_id ASC
    `,
  });

  const replace: GitWorkbenchQueueRepositoryShape["replace"] = (workflow) =>
    replaceRow(workflow).pipe(Effect.map(fromDbRow), Effect.mapError(persistenceError("replace")));

  const get: GitWorkbenchQueueRepositoryShape["get"] = (scope) =>
    getRow(scope).pipe(Effect.map(Option.map(fromDbRow)), Effect.mapError(persistenceError("get")));

  const saveExpected: GitWorkbenchQueueRepositoryShape["saveExpected"] = (
    workflow,
    expectedRevision,
  ) =>
    saveExpectedRow({ workflow, expectedRevision }).pipe(
      Effect.map(Option.map(fromDbRow)),
      Effect.mapError(persistenceError("saveExpected")),
    );

  const removeExpected: GitWorkbenchQueueRepositoryShape["removeExpected"] = (
    scope,
    expectedRevision,
  ) =>
    removeExpectedRow({ scope, expectedRevision }).pipe(
      Effect.map(Option.isSome),
      Effect.mapError(persistenceError("removeExpected")),
    );

  const listWaitingForTurn: GitWorkbenchQueueRepositoryShape["listWaitingForTurn"] = (
    threadId,
    turnId,
  ) =>
    listWaitingRows({ threadId, turnId }).pipe(
      Effect.map((rows) => rows.map(fromDbRow)),
      Effect.mapError(persistenceError("listWaitingForTurn")),
    );

  const listRecoverable: GitWorkbenchQueueRepositoryShape["listRecoverable"] = () =>
    listRecoverableRows().pipe(
      Effect.map((rows) => rows.map(fromDbRow)),
      Effect.mapError(persistenceError("listRecoverable")),
    );

  return GitWorkbenchQueueRepository.of({
    replace,
    get,
    saveExpected,
    removeExpected,
    listWaitingForTurn,
    listRecoverable,
  });
});

export const GitWorkbenchQueueRepositoryLive = Layer.effect(GitWorkbenchQueueRepository, make);
