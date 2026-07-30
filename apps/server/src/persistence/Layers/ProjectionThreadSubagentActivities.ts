import { NonNegativeInt } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadSubagentActivitiesByThreadInput,
  DeleteProjectionThreadSubagentActivitiesInput,
  ListProjectionThreadSubagentActivitiesInput,
  ProjectionThreadSubagentActivity,
  ProjectionThreadSubagentActivityRepository,
  type ProjectionThreadSubagentActivityRepositoryShape,
} from "../Services/ProjectionThreadSubagentActivities.ts";

const ProjectionThreadSubagentActivityDbRow = ProjectionThreadSubagentActivity.mapFields(
  Struct.assign({
    payload: Schema.fromJsonString(Schema.Unknown),
    sequence: Schema.NullOr(NonNegativeInt),
  }),
);

const toRepositoryError = (sqlOperation: string, decodeOperation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(decodeOperation)(cause)
    : toPersistenceSqlError(sqlOperation)(cause);

const makeProjectionThreadSubagentActivityRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadSubagentActivity,
    execute: (row) => sql`
      INSERT INTO projection_thread_subagent_activities (
        thread_id,
        subagent_id,
        activity_id,
        turn_id,
        tone,
        kind,
        summary,
        payload_json,
        sequence,
        created_at
      )
      VALUES (
        ${row.threadId},
        ${row.subagentId},
        ${row.activityId},
        ${row.turnId},
        ${row.tone},
        ${row.kind},
        ${row.summary},
        ${JSON.stringify(row.payload)},
        ${row.sequence ?? null},
        ${row.createdAt}
      )
      ON CONFLICT (thread_id, subagent_id, activity_id)
      DO UPDATE SET
        turn_id = excluded.turn_id,
        tone = excluded.tone,
        kind = excluded.kind,
        summary = excluded.summary,
        payload_json = excluded.payload_json,
        sequence = excluded.sequence,
        created_at = excluded.created_at
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionThreadSubagentActivitiesInput,
    Result: ProjectionThreadSubagentActivityDbRow,
    execute: ({ threadId, subagentId }) => sql`
      SELECT
        thread_id AS "threadId",
        subagent_id AS "subagentId",
        activity_id AS "activityId",
        turn_id AS "turnId",
        tone,
        kind,
        summary,
        payload_json AS "payload",
        sequence,
        created_at AS "createdAt"
      FROM projection_thread_subagent_activities
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
      ORDER BY
        CASE WHEN sequence IS NULL THEN 0 ELSE 1 END ASC,
        sequence ASC,
        created_at ASC,
        activity_id ASC
    `,
  });

  const deleteRows = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentActivitiesInput,
    execute: ({ threadId, subagentId }) => sql`
      DELETE FROM projection_thread_subagent_activities
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
    `,
  });

  const deleteRowsByThread = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentActivitiesByThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_subagent_activities
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadSubagentActivityRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentActivityRepository.upsert:query",
          "ProjectionThreadSubagentActivityRepository.upsert:encodeRequest",
        ),
      ),
    );

  const listBySubagentId: ProjectionThreadSubagentActivityRepositoryShape["listBySubagentId"] = (
    input,
  ) =>
    listRows(input).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentActivityRepository.listBySubagentId:query",
          "ProjectionThreadSubagentActivityRepository.listBySubagentId:decodeRows",
        ),
      ),
      Effect.map((rows) =>
        rows.map((row) => ({
          threadId: row.threadId,
          subagentId: row.subagentId,
          activityId: row.activityId,
          turnId: row.turnId,
          tone: row.tone,
          kind: row.kind,
          summary: row.summary,
          payload: row.payload,
          ...(row.sequence === null ? {} : { sequence: row.sequence }),
          createdAt: row.createdAt,
        })),
      ),
    );

  const deleteBySubagentId: ProjectionThreadSubagentActivityRepositoryShape["deleteBySubagentId"] =
    (input) =>
      deleteRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionThreadSubagentActivityRepository.deleteBySubagentId:query",
          ),
        ),
      );

  const deleteByThreadId: ProjectionThreadSubagentActivityRepositoryShape["deleteByThreadId"] = (
    input,
  ) =>
    deleteRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentActivityRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    listBySubagentId,
    deleteBySubagentId,
    deleteByThreadId,
  } satisfies ProjectionThreadSubagentActivityRepositoryShape;
});

export const ProjectionThreadSubagentActivityRepositoryLive = Layer.effect(
  ProjectionThreadSubagentActivityRepository,
  makeProjectionThreadSubagentActivityRepository,
);
