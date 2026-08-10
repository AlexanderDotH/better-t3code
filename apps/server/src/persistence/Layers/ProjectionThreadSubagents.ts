import { OrchestrationLatestTurn, OrchestrationSubagentProgress } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Struct from "effect/Struct";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceDecodeError, toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadSubagentInput,
  DeleteProjectionThreadSubagentsInput,
  GetProjectionThreadSubagentInput,
  ListProjectionThreadSubagentsInput,
  ProjectionThreadSubagent,
  ProjectionThreadSubagentRepository,
  type ProjectionThreadSubagentRepositoryShape,
} from "../Services/ProjectionThreadSubagents.ts";

const ProjectionThreadSubagentDbRow = ProjectionThreadSubagent.mapFields(
  Struct.assign({
    latestProgress: Schema.NullOr(Schema.fromJsonString(OrchestrationSubagentProgress)),
    latestTurn: Schema.NullOr(Schema.fromJsonString(OrchestrationLatestTurn)),
  }),
);

const toRepositoryError = (sqlOperation: string, decodeOperation: string) => (cause: unknown) =>
  Schema.isSchemaError(cause)
    ? toPersistenceDecodeError(decodeOperation)(cause)
    : toPersistenceSqlError(sqlOperation)(cause);

const makeProjectionThreadSubagentRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadSubagent,
    execute: (row) => sql`
      INSERT INTO projection_thread_subagents (
        thread_id,
        subagent_id,
        origin,
        provider_instance_id,
        provider_driver,
        provider_thread_id,
        parent_subagent_id,
        path,
        name,
        nickname,
        role,
        task,
        model,
        reasoning_effort,
        depth,
        status,
        status_message,
        latest_progress_json,
        latest_turn_json,
        started_at,
        updated_at,
        completed_at
      )
      VALUES (
        ${row.threadId},
        ${row.id},
        ${row.origin},
        ${row.providerInstanceId},
        ${row.providerDriver},
        ${row.providerThreadId},
        ${row.parentId},
        ${row.path},
        ${row.name},
        ${row.nickname},
        ${row.role},
        ${row.task},
        ${row.model},
        ${row.reasoningEffort},
        ${row.depth},
        ${row.status},
        ${row.statusMessage},
        ${row.latestProgress === null ? null : JSON.stringify(row.latestProgress)},
        ${row.latestTurn === null ? null : JSON.stringify(row.latestTurn)},
        ${row.startedAt},
        ${row.updatedAt},
        ${row.completedAt}
      )
      ON CONFLICT (thread_id, subagent_id)
      DO UPDATE SET
        origin = excluded.origin,
        provider_instance_id = excluded.provider_instance_id,
        provider_driver = excluded.provider_driver,
        provider_thread_id = excluded.provider_thread_id,
        parent_subagent_id = excluded.parent_subagent_id,
        path = excluded.path,
        name = excluded.name,
        nickname = excluded.nickname,
        role = excluded.role,
        task = excluded.task,
        model = excluded.model,
        reasoning_effort = excluded.reasoning_effort,
        depth = excluded.depth,
        status = excluded.status,
        status_message = excluded.status_message,
        latest_progress_json = excluded.latest_progress_json,
        latest_turn_json = excluded.latest_turn_json,
        started_at = excluded.started_at,
        updated_at = excluded.updated_at,
        completed_at = excluded.completed_at
    `,
  });

  const getRow = SqlSchema.findOneOption({
    Request: GetProjectionThreadSubagentInput,
    Result: ProjectionThreadSubagentDbRow,
    execute: ({ threadId, subagentId }) => sql`
      SELECT
        thread_id AS "threadId",
        subagent_id AS "id",
        origin,
        provider_instance_id AS "providerInstanceId",
        provider_driver AS "providerDriver",
        provider_thread_id AS "providerThreadId",
        parent_subagent_id AS "parentId",
        path,
        name,
        nickname,
        role,
        task,
        model,
        reasoning_effort AS "reasoningEffort",
        depth,
        status,
        status_message AS "statusMessage",
        latest_progress_json AS "latestProgress",
        latest_turn_json AS "latestTurn",
        started_at AS "startedAt",
        updated_at AS "updatedAt",
        completed_at AS "completedAt"
      FROM projection_thread_subagents
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
      LIMIT 1
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionThreadSubagentsInput,
    Result: ProjectionThreadSubagentDbRow,
    execute: ({ threadId }) => sql`
      SELECT
        thread_id AS "threadId",
        subagent_id AS "id",
        origin,
        provider_instance_id AS "providerInstanceId",
        provider_driver AS "providerDriver",
        provider_thread_id AS "providerThreadId",
        parent_subagent_id AS "parentId",
        path,
        name,
        nickname,
        role,
        task,
        model,
        reasoning_effort AS "reasoningEffort",
        depth,
        status,
        status_message AS "statusMessage",
        latest_progress_json AS "latestProgress",
        latest_turn_json AS "latestTurn",
        started_at AS "startedAt",
        updated_at AS "updatedAt",
        completed_at AS "completedAt"
      FROM projection_thread_subagents
      WHERE thread_id = ${threadId}
      ORDER BY updated_at DESC, subagent_id ASC
    `,
  });

  const deleteRow = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentInput,
    execute: ({ threadId, subagentId }) => sql`
      DELETE FROM projection_thread_subagents
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
    `,
  });

  const deleteRowsByThread = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentsInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_subagents
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadSubagentRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentRepository.upsert:query",
          "ProjectionThreadSubagentRepository.upsert:encodeRequest",
        ),
      ),
    );

  const getById: ProjectionThreadSubagentRepositoryShape["getById"] = (input) =>
    getRow(input).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentRepository.getById:query",
          "ProjectionThreadSubagentRepository.getById:decodeRow",
        ),
      ),
      Effect.map(Option.map((row) => row)),
    );

  const listByThreadId: ProjectionThreadSubagentRepositoryShape["listByThreadId"] = (input) =>
    listRows(input).pipe(
      Effect.mapError(
        toRepositoryError(
          "ProjectionThreadSubagentRepository.listByThreadId:query",
          "ProjectionThreadSubagentRepository.listByThreadId:decodeRows",
        ),
      ),
    );

  const deleteBySubagentId: ProjectionThreadSubagentRepositoryShape["deleteBySubagentId"] = (
    input,
  ) =>
    deleteRow(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentRepository.deleteBySubagentId:query"),
      ),
    );

  const deleteByThreadId: ProjectionThreadSubagentRepositoryShape["deleteByThreadId"] = (input) =>
    deleteRowsByThread(input).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentRepository.deleteByThreadId:query"),
      ),
    );

  return {
    upsert,
    getById,
    listByThreadId,
    deleteBySubagentId,
    deleteByThreadId,
  } satisfies ProjectionThreadSubagentRepositoryShape;
});

export const ProjectionThreadSubagentRepositoryLive = Layer.effect(
  ProjectionThreadSubagentRepository,
  makeProjectionThreadSubagentRepository,
);
