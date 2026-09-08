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
  ListProjectionThreadSubagentActivityPageInput,
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

  // Select a structurally bounded newest-first candidate set, then apply a
  // cumulative raw-byte budget before JSON decoding. The newest row is always
  // admitted so a single oversized tool result remains reachable without
  // allowing every large result behind it into the same heap at once.
  const listPageRows = SqlSchema.findAll({
    Request: ListProjectionThreadSubagentActivityPageInput,
    Result: ProjectionThreadSubagentActivityDbRow,
    execute: ({ threadId, subagentId, before, limit, maxBytes }) => {
      const beforeHasSequence = before?.sequence === null ? 0 : 1;
      const beforeSequence = before?.sequence ?? 0;
      const beforeCreatedAt = before?.createdAt ?? "";
      const beforeActivityId = before?.activityId ?? "";
      return sql`
        WITH limited AS (
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
            created_at AS "createdAt",
            CASE WHEN sequence IS NULL THEN 0 ELSE 1 END AS has_sequence,
            LENGTH(CAST(payload_json AS BLOB))
              + LENGTH(CAST(summary AS BLOB))
              + LENGTH(CAST(kind AS BLOB))
              + 64 AS raw_bytes
          FROM projection_thread_subagent_activities
          WHERE thread_id = ${threadId}
            AND subagent_id = ${subagentId}
            AND (
              ${before === null ? 1 : 0} = 1
              OR CASE WHEN sequence IS NULL THEN 0 ELSE 1 END < ${beforeHasSequence}
              OR (
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END = ${beforeHasSequence}
                AND COALESCE(sequence, 0) < ${beforeSequence}
              )
              OR (
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END = ${beforeHasSequence}
                AND COALESCE(sequence, 0) = ${beforeSequence}
                AND created_at < ${beforeCreatedAt}
              )
              OR (
                CASE WHEN sequence IS NULL THEN 0 ELSE 1 END = ${beforeHasSequence}
                AND COALESCE(sequence, 0) = ${beforeSequence}
                AND created_at = ${beforeCreatedAt}
                AND activity_id < ${beforeActivityId}
              )
            )
          ORDER BY
            has_sequence DESC,
            sequence DESC,
            created_at DESC,
            activity_id DESC
          LIMIT ${limit}
        ),
        budgeted AS (
          SELECT
            *,
            ROW_NUMBER() OVER (
              ORDER BY has_sequence DESC, sequence DESC, "createdAt" DESC, "activityId" DESC
            ) AS page_row,
            SUM(raw_bytes) OVER (
              ORDER BY has_sequence DESC, sequence DESC, "createdAt" DESC, "activityId" DESC
              ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
            ) AS cumulative_bytes
          FROM limited
        )
        SELECT
          "threadId",
          "subagentId",
          "activityId",
          "turnId",
          tone,
          kind,
          summary,
          payload,
          sequence,
          "createdAt"
        FROM budgeted
        WHERE page_row = 1 OR cumulative_bytes <= ${maxBytes}
        ORDER BY
          has_sequence ASC,
          sequence ASC,
          "createdAt" ASC,
          "activityId" ASC
      `;
    },
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

  const mapActivityRows = (
    rows: ReadonlyArray<typeof ProjectionThreadSubagentActivityDbRow.Type>,
  ): ReadonlyArray<typeof ProjectionThreadSubagentActivity.Type> =>
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
    }));

  const listPageBySubagentId: ProjectionThreadSubagentActivityRepositoryShape["listPageBySubagentId"] =
    (input) =>
      listPageRows(input).pipe(
        Effect.mapError(
          toRepositoryError(
            "ProjectionThreadSubagentActivityRepository.listPageBySubagentId:query",
            "ProjectionThreadSubagentActivityRepository.listPageBySubagentId:decodeRows",
          ),
        ),
        Effect.map(mapActivityRows),
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
    listPageBySubagentId,
    deleteBySubagentId,
    deleteByThreadId,
  } satisfies ProjectionThreadSubagentActivityRepositoryShape;
});

export const ProjectionThreadSubagentActivityRepositoryLive = Layer.effect(
  ProjectionThreadSubagentActivityRepository,
  makeProjectionThreadSubagentActivityRepository,
);
