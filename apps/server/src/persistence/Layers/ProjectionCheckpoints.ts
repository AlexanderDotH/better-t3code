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
  DeleteByThreadIdInput,
  GetByThreadAndTurnCountInput,
  ListByThreadIdInput,
  ProjectionCheckpoint,
  ProjectionCheckpointRepository,
  type ProjectionCheckpointRepositoryShape,
} from "../Services/ProjectionCheckpoints.ts";

const ProjectionCheckpointDbRowSchema = ProjectionCheckpoint.mapFields(
  Struct.assign({
    files: Schema.fromJsonString(Schema.Array(OrchestrationCheckpointFile)),
    historyOrigin: Schema.NullOr(Schema.fromJsonString(OrchestrationHistoryOrigin)),
  }),
);

function toProjectionCheckpoint(
  row: typeof ProjectionCheckpointDbRowSchema.Type,
): ProjectionCheckpoint {
  const { historyOrigin, ...checkpoint } = row;
  return {
    ...checkpoint,
    ...(historyOrigin !== null ? { historyOrigin } : {}),
  };
}

function toPersistenceSqlOrDecodeError(sqlOperation: string, decodeOperation: string) {
  return (cause: unknown) =>
    Schema.isSchemaError(cause)
      ? toPersistenceDecodeError(decodeOperation)(cause)
      : toPersistenceSqlError(sqlOperation)(cause);
}

const makeProjectionCheckpointRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const clearCheckpointConflict = SqlSchema.void({
    Request: GetByThreadAndTurnCountInput,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
      `,
  });

  const upsertProjectionCheckpointRow = SqlSchema.void({
    Request: ProjectionCheckpointDbRowSchema,
    execute: (row) =>
      sql`
        INSERT INTO projection_turns (
          thread_id,
          turn_id,
          pending_message_id,
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
          ${row.turnId},
          NULL,
          ${row.assistantMessageId},
          ${row.status === "error" ? "error" : "completed"},
          ${row.completedAt},
          ${row.completedAt},
          ${row.completedAt},
          ${row.checkpointTurnCount},
          ${row.checkpointRef},
          ${row.status},
          ${row.files}
        )
        ON CONFLICT (thread_id, turn_id)
        DO UPDATE SET
          assistant_message_id = excluded.assistant_message_id,
          state = excluded.state,
          completed_at = excluded.completed_at,
          checkpoint_turn_count = excluded.checkpoint_turn_count,
          checkpoint_ref = excluded.checkpoint_ref,
          checkpoint_status = excluded.checkpoint_status,
          checkpoint_files_json = excluded.checkpoint_files_json
      `,
  });

  const upsertHistoricalCheckpointRow = SqlSchema.void({
    Request: ProjectionCheckpointDbRowSchema,
    execute: (row) => sql`
      INSERT INTO projection_thread_fork_checkpoints (
        thread_id,
        turn_id,
        checkpoint_turn_count,
        checkpoint_ref,
        checkpoint_status,
        checkpoint_files_json,
        assistant_message_id,
        completed_at,
        history_origin_json
      ) VALUES (
        ${row.threadId},
        ${row.turnId},
        ${row.checkpointTurnCount},
        ${row.checkpointRef},
        ${row.status},
        ${row.files},
        ${row.assistantMessageId},
        ${row.completedAt},
        ${row.historyOrigin}
      )
      ON CONFLICT (thread_id, turn_id)
      DO UPDATE SET
        checkpoint_turn_count = excluded.checkpoint_turn_count,
        checkpoint_ref = excluded.checkpoint_ref,
        checkpoint_status = excluded.checkpoint_status,
        checkpoint_files_json = excluded.checkpoint_files_json,
        assistant_message_id = excluded.assistant_message_id,
        completed_at = excluded.completed_at,
        history_origin_json = excluded.history_origin_json
    `,
  });

  const listProjectionCheckpointRows = SqlSchema.findAll({
    Request: ListByThreadIdInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId }) =>
      sql`
        SELECT * FROM (
          SELECT
            thread_id AS "threadId",
            turn_id AS "turnId",
            checkpoint_turn_count AS "checkpointTurnCount",
            checkpoint_ref AS "checkpointRef",
            checkpoint_status AS "status",
            checkpoint_files_json AS "files",
            assistant_message_id AS "assistantMessageId",
            completed_at AS "completedAt",
            NULL AS "historyOrigin"
          FROM projection_turns
          WHERE thread_id = ${threadId}
            AND checkpoint_turn_count IS NOT NULL
            AND history_origin_json IS NULL
          UNION ALL
          SELECT
            thread_id AS "threadId",
            turn_id AS "turnId",
            checkpoint_turn_count AS "checkpointTurnCount",
            checkpoint_ref AS "checkpointRef",
            checkpoint_status AS "status",
            checkpoint_files_json AS "files",
            assistant_message_id AS "assistantMessageId",
            completed_at AS "completedAt",
            history_origin_json AS "historyOrigin"
          FROM projection_thread_fork_checkpoints
          WHERE thread_id = ${threadId}
        )
        ORDER BY "checkpointTurnCount" ASC, "historyOrigin" DESC
      `,
  });

  const getProjectionCheckpointRow = SqlSchema.findOneOption({
    Request: GetByThreadAndTurnCountInput,
    Result: ProjectionCheckpointDbRowSchema,
    execute: ({ threadId, checkpointTurnCount }) =>
      sql`
        SELECT
          thread_id AS "threadId",
          turn_id AS "turnId",
          checkpoint_turn_count AS "checkpointTurnCount",
          checkpoint_ref AS "checkpointRef",
          checkpoint_status AS "status",
          checkpoint_files_json AS "files",
          assistant_message_id AS "assistantMessageId",
          completed_at AS "completedAt",
          NULL AS "historyOrigin"
        FROM projection_turns
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count = ${checkpointTurnCount}
          AND history_origin_json IS NULL
      `,
  });

  const deleteProjectionCheckpointRows = SqlSchema.void({
    Request: DeleteByThreadIdInput,
    execute: ({ threadId }) =>
      sql`
        UPDATE projection_turns
        SET
          checkpoint_turn_count = NULL,
          checkpoint_ref = NULL,
          checkpoint_status = NULL,
          checkpoint_files_json = '[]'
        WHERE thread_id = ${threadId}
          AND checkpoint_turn_count IS NOT NULL
          AND history_origin_json IS NULL
      `,
  });

  const upsertCheckpointRow = (row: Schema.Schema.Type<typeof ProjectionCheckpointDbRowSchema>) =>
    sql.withTransaction(
      clearCheckpointConflict({
        threadId: row.threadId,
        checkpointTurnCount: row.checkpointTurnCount,
      }).pipe(Effect.flatMap(() => upsertProjectionCheckpointRow(row))),
    );

  const upsert: ProjectionCheckpointRepositoryShape["upsert"] = (row) =>
    upsertCheckpointRow({ ...row, historyOrigin: null }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.upsert:query",
          "ProjectionCheckpointRepository.upsert:encodeRequest",
        ),
      ),
    );

  const upsertHistorical: ProjectionCheckpointRepositoryShape["upsertHistorical"] = (row) =>
    upsertHistoricalCheckpointRow({ ...row, historyOrigin: row.historyOrigin }).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.upsertHistorical:query",
          "ProjectionCheckpointRepository.upsertHistorical:encodeRequest",
        ),
      ),
    );

  const listByThreadId: ProjectionCheckpointRepositoryShape["listByThreadId"] = (input) =>
    listProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.listByThreadId:query",
          "ProjectionCheckpointRepository.listByThreadId:decodeRows",
        ),
      ),
      Effect.map((rows) => rows.map(toProjectionCheckpoint)),
    );

  const getByThreadAndTurnCount: ProjectionCheckpointRepositoryShape["getByThreadAndTurnCount"] = (
    input,
  ) =>
    getProjectionCheckpointRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlOrDecodeError(
          "ProjectionCheckpointRepository.getByThreadAndTurnCount:query",
          "ProjectionCheckpointRepository.getByThreadAndTurnCount:decodeRow",
        ),
      ),
      Effect.flatMap((rowOption) =>
        Option.match(rowOption, {
          onNone: () => Effect.succeed(Option.none()),
          onSome: (row) => Effect.succeed(Option.some(toProjectionCheckpoint(row))),
        }),
      ),
    );

  const deleteByThreadId: ProjectionCheckpointRepositoryShape["deleteByThreadId"] = (input) =>
    deleteProjectionCheckpointRows(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionCheckpointRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    upsertHistorical,
    listByThreadId,
    getByThreadAndTurnCount,
    deleteByThreadId,
  } satisfies ProjectionCheckpointRepositoryShape;
});

export const ProjectionCheckpointRepositoryLive = Layer.effect(
  ProjectionCheckpointRepository,
  makeProjectionCheckpointRepository,
);
