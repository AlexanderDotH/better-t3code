import { OrchestrationCheckpointFile, OrchestrationHistoryOrigin } from "@t3tools/contracts";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  ClearCheckpointTurnConflictInput,
  DeleteProjectionTurnsByThreadInput,
  GetProjectionPendingTurnStartInput,
  GetProjectionTurnByTurnIdInput,
  ListProjectionTurnsByThreadInput,
  ProjectionPendingTurnStart,
  ProjectionTurn,
  ProjectionTurnById,
  ProjectionTurnRepository,
  type ProjectionTurnRepositoryShape,
} from "../Services/ProjectionTurns.ts";

const ProjectionTurnDbRowSchema = ProjectionTurn.mapFields(
  Struct.assign({
    checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
    historyOrigin: Schema.NullOr(Schema.fromJsonString(OrchestrationHistoryOrigin)),
  }),
);

const ProjectionTurnByIdDbRowSchema = ProjectionTurnById.mapFields(
  Struct.assign({
    checkpointFiles: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
    historyOrigin: Schema.NullOr(Schema.fromJsonString(OrchestrationHistoryOrigin)),
  }),
);
const encodeHistoryOrigin = Schema.encodeSync(Schema.fromJsonString(OrchestrationHistoryOrigin));
const encodeCheckpointFiles = Schema.encodeSync(
  Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
);

function toProjectionTurn(row: typeof ProjectionTurnDbRowSchema.Type): ProjectionTurn {
  const { historyOrigin, ...turn } = row;
  return {
    ...turn,
    ...(historyOrigin !== null ? { historyOrigin } : {}),
  };
}

function toProjectionTurnById(row: typeof ProjectionTurnByIdDbRowSchema.Type): ProjectionTurnById {
  const { historyOrigin, ...turn } = row;
  return {
    ...turn,
    ...(historyOrigin !== null ? { historyOrigin } : {}),
  };
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionTurnRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionTurnById = SqlSchema.void({
    Request: ProjectionTurnByIdDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
          , history_origin_json
        )
        VALUES (
          ${row.threadId},
          ${row.turnId},
          ${row.pendingMessageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.assistantMessageId},
          ${row.state},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.checkpointStatus},
          ${row.checkpointFiles}
          , ${row.historyOrigin}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          pending_message_id = excluded.pending_message_id,
          source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
          source_proposed_plan_id = excluded.source_proposed_plan_id,
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          requested_at = excluded.requested_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
          , history_origin_json = COALESCE(
            excluded.history_origin_json,
            projection_turns.history_origin_json
          )
      `,
  });

  const upsertHistoricalTurnById = SqlSchema.void({
    Request: ProjectionTurnByIdDbRowSchema,
    execute: (row) => sql`
      INSERT INTO projection_turns (
        thread_id,
        turn_id,
        pending_message_id,
        source_proposed_plan_thread_id,
        source_proposed_plan_id,
        assistant_message_id,
        state,
        requested_at,
        started_at,
        completed_at,
        checkpoint_turn_count,
        checkpoint_ref,
        checkpoint_status,
        checkpoint_files_json,
        history_origin_json,
        history_checkpoint_turn_count,
        history_checkpoint_ref,
        history_checkpoint_status,
        history_checkpoint_files_json
      ) VALUES (
        ${row.threadId},
        ${row.turnId},
        ${row.pendingMessageId},
        ${row.sourceProposedPlanThreadId},
        ${row.sourceProposedPlanId},
        ${row.assistantMessageId},
        ${row.state},
        ${row.requestedAt},
        ${row.startedAt},
        ${row.completedAt},
        NULL,
        NULL,
        NULL,
        '[]',
        ${row.historyOrigin},
        ${row.checkpointTurnCount},
        ${row.checkpointRef},
        ${row.checkpointStatus},
        ${row.checkpointFiles}
      )
      ON CONFLICT (thread_id, turn_id)
      DO UPDATE SET
        pending_message_id = excluded.pending_message_id,
        source_proposed_plan_thread_id = excluded.source_proposed_plan_thread_id,
        source_proposed_plan_id = excluded.source_proposed_plan_id,
        assistant_message_id = excluded.assistant_message_id,
        state = excluded.state,
        requested_at = excluded.requested_at,
        started_at = excluded.started_at,
        completed_at = excluded.completed_at,
        checkpoint_turn_count = NULL,
        checkpoint_ref = NULL,
        checkpoint_status = NULL,
        checkpoint_files_json = '[]',
        history_origin_json = excluded.history_origin_json,
        history_checkpoint_turn_count = excluded.history_checkpoint_turn_count,
        history_checkpoint_ref = excluded.history_checkpoint_ref,
        history_checkpoint_status = excluded.history_checkpoint_status,
        history_checkpoint_files_json = excluded.history_checkpoint_files_json
    `,
  });

  const clearPendingProjectionTurnsByThread = SqlSchema.void({
    Request: DeleteProjectionTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND checkpoint_turn_count IS NULL
          AND history_origin_json IS NULL
      `,
  });

  const insertPendingProjectionTurn = SqlSchema.void({
    Request: ProjectionPendingTurnStart,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json
        )
        VALUES (
          ${row.threadId},
          NULL,
          ${row.messageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          NULL,
          'pending',
          ${row.requestedAt},
          NULL,
          NULL,
          NULL,
          NULL,
          NULL,
          '[]'
        )
      `,
  });

  const getPendingProjectionTurn = SqlSchema.findOneOption({
    Request: GetProjectionPendingTurnStartInput,
    Result: ProjectionPendingTurnStart,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          pending_message_id AS "messageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          requested_at AS "requestedAt"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id IS NULL
          AND state = 'pending'
          AND pending_message_id IS NOT NULL
          AND checkpoint_turn_count IS NULL
          AND history_origin_json IS NULL
        ORDER BY requested_at DESC
        LIMIT 1
      `,
  });

  const listProjectionTurnsByThread = SqlSchema.findAll({
    Request: ListProjectionTurnsByThreadInput,
    Result: ProjectionTurnDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_turn_count
            ELSE history_checkpoint_turn_count
          END AS "checkpointTurnCount",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_ref
            ELSE history_checkpoint_ref
          END AS "checkpointRef",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_status
            ELSE history_checkpoint_status
          END AS "checkpointStatus",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_files_json
            ELSE COALESCE(history_checkpoint_files_json, '[]')
          END AS "checkpointFiles"
          , history_origin_json AS "historyOrigin"
        FROM projection_turns
        WHERE thread_id = ${threadId}
        ORDER BY
          CASE
            WHEN COALESCE(checkpoint_turn_count, history_checkpoint_turn_count) IS NULL THEN 1
            ELSE 0
          END ASC,
          COALESCE(checkpoint_turn_count, history_checkpoint_turn_count) ASC,
          requested_at ASC,
          turn_id ASC
      `,
  });

  const getProjectionTurnByTurnId = SqlSchema.findOneOption({
    Request: GetProjectionTurnByTurnIdInput,
    Result: ProjectionTurnByIdDbRowSchema,
    execute: ({ threadId, turnId }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          pending_message_id AS "pendingMessageId",
          source_proposed_plan_thread_id AS "sourceProposedPlanThreadId",
          source_proposed_plan_id AS "sourceProposedPlanId",
          assistant_message_id AS "assistantMessageId",
          state,
          requested_at AS "requestedAt",
          started_at AS "startedAt",
          completed_at AS "completedAt",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_turn_count
            ELSE history_checkpoint_turn_count
          END AS "checkpointTurnCount",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_ref
            ELSE history_checkpoint_ref
          END AS "checkpointRef",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_status
            ELSE history_checkpoint_status
          END AS "checkpointStatus",
          CASE
            WHEN history_origin_json IS NULL THEN checkpoint_files_json
            ELSE COALESCE(history_checkpoint_files_json, '[]')
          END AS "checkpointFiles"
          , history_origin_json AS "historyOrigin"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND turn_id = ${turnId}
        LIMIT 1
      `,
  });

  const clearCheckpointTurnConflictRow = SqlSchema.void({
    Request: ClearCheckpointTurnConflictInput,
    execute: ({ threadId, turnId, checkpointTurnCount }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
          AND (turn_id IS NULL OR turn_id <> ${turnId})
          AND history_origin_json IS NULL
      `,
  });

  const deleteProjectionTurnsByThread = SqlSchema.void({
    Request: DeleteProjectionTurnsByThreadInput,
    execute: ({ threadId }) =>
      sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${threadId}
      `,
  });

  const upsertByTurnId: ProjectionTurnRepositoryShape["upsertByTurnId"] = (row) =>
    upsertProjectionTurnById({
      ...row,
      historyOrigin: row.historyOrigin ?? null,
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.upsertByTurnId:query",
          "ProjectionTurnRepository.upsertByTurnId:encodeRequest",
        ),
      ),
    );

  const upsertHistorical: ProjectionTurnRepositoryShape["upsertHistorical"] = (row) =>
    Effect.gen(function* () {
      const historyOriginJson =
        row.historyOrigin === undefined ? null : encodeHistoryOrigin(row.historyOrigin);
      if (row.turnId !== null) {
        yield* upsertHistoricalTurnById({
          ...row,
          turnId: row.turnId,
          historyOrigin: row.historyOrigin ?? null,
        });
        return;
      }
      yield* sql`
        DELETE FROM projection_turns
        WHERE thread_id = ${row.threadId}
          AND turn_id IS NULL
          AND history_origin_json = ${historyOriginJson}
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
          source_proposed_plan_thread_id,
          source_proposed_plan_id,
          assistant_message_id,
          state,
          requested_at,
          started_at,
          completed_at,
          checkpoint_turn_count,
          checkpoint_ref,
          checkpoint_status,
          checkpoint_files_json,
          history_origin_json,
          history_checkpoint_turn_count,
          history_checkpoint_ref,
          history_checkpoint_status,
          history_checkpoint_files_json
        ) VALUES (
          ${row.threadId},
          NULL,
          ${row.pendingMessageId},
          ${row.sourceProposedPlanThreadId},
          ${row.sourceProposedPlanId},
          ${row.assistantMessageId},
          ${row.state},
          ${row.requestedAt},
          ${row.startedAt},
          ${row.completedAt},
          NULL,
          NULL,
          NULL,
          '[]',
          ${historyOriginJson},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.checkpointStatus},
          ${encodeCheckpointFiles(row.checkpointFiles)}
        )
      `;
    }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.upsertHistorical:query",
          "ProjectionTurnRepository.upsertHistorical:encodeRequest",
        ),
      ),
    );

  const replacePendingTurnStart: ProjectionTurnRepositoryShape["replacePendingTurnStart"] = (row) =>
    sql
      .withTransaction(
        clearPendingProjectionTurnsByThread({ threadId: row.threadId }).pipe(
          Effect.flatMap(() => insertPendingProjectionTurn(row)),
        ),
      )
      .pipe(
        Effect.mapError(
          toPersistenceSqlOrDecodeError(
            "ProjectionTurnRepository.replacePendingTurnStart:query",
            "ProjectionTurnRepository.replacePendingTurnStart:encodeRequest",
          ),
        ),
      );

  const getPendingTurnStartByThreadId: ProjectionTurnRepositoryShape["getPendingTurnStartByThreadId"] =
    (input) =>
      getPendingProjectionTurn(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionTurnRepository.getPendingTurnStartByThreadId:query"),
        ),
      );

  const deletePendingTurnStartByThreadId: ProjectionTurnRepositoryShape["deletePendingTurnStartByThreadId"] =
    (input) =>
      clearPendingProjectionTurnsByThread(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionTurnRepository.deletePendingTurnStartByThreadId:query"),
        ),
      );

  const listByThreadId: ProjectionTurnRepositoryShape["listByThreadId"] = (input) =>
    listProjectionTurnsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.listByThreadId:query",
          "ProjectionTurnRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(toProjectionTurn)),
    );

  const getByTurnId: ProjectionTurnRepositoryShape["getByTurnId"] = (input) =>
    getProjectionTurnByTurnId(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionTurnRepository.getByTurnId:query",
          "ProjectionTurnRepository.getByTurnId:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => Effect.succeed(Option.some(toProjectionTurnById(row))),
        }),
      ),
    );

  const clearCheckpointTurnConflict: ProjectionTurnRepositoryShape["clearCheckpointTurnConflict"] =
    (input) =>
      clearCheckpointTurnConflictRow(input).pipe(
        Effect.mapError(
          toPersistenceSqlError("ProjectionTurnRepository.clearCheckpointTurnConflict:query"),
        ),
      );

  const deleteByThreadId: ProjectionTurnRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionTurnsByThread(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionTurnRepository.deleteByThreadId:query")),
    );

  return {
    upsertHistorical,
    upsertByTurnId,
    replacePendingTurnStart,
    getPendingTurnStartByThreadId,
    deletePendingTurnStartByThreadId,
    listByThreadId,
    getByTurnId,
    clearCheckpointTurnConflict,
    deleteByThreadId,
  } satisfies ProjectionTurnRepositoryShape;
});

export const ProjectionTurnRepositoryLive = Layer.effect(
  ProjectionTurnRepository,
  makeProjectionTurnRepository,
);
