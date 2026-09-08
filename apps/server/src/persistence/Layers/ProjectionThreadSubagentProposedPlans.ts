import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";

import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionThreadSubagentProposedPlansByThreadInput,
  DeleteProjectionThreadSubagentProposedPlansInput,
  ListProjectionThreadSubagentProposedPlansInput,
  ProjectionThreadSubagentProposedPlan,
  ProjectionThreadSubagentProposedPlanRepository,
  type ProjectionThreadSubagentProposedPlanRepositoryShape,
} from "../Services/ProjectionThreadSubagentProposedPlans.ts";

const makeProjectionThreadSubagentProposedPlanRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertRow = SqlSchema.void({
    Request: ProjectionThreadSubagentProposedPlan,
    execute: (row) => sql`
      INSERT INTO projection_thread_subagent_proposed_plans (
        thread_id,
        subagent_id,
        plan_id,
        turn_id,
        plan_markdown,
        implemented_at,
        implementation_thread_id,
        created_at,
        updated_at
      )
      VALUES (
        ${row.threadId},
        ${row.subagentId},
        ${row.planId},
        ${row.turnId},
        ${row.planMarkdown},
        ${row.implementedAt},
        ${row.implementationThreadId},
        ${row.createdAt},
        ${row.updatedAt}
      )
      ON CONFLICT (thread_id, subagent_id, plan_id)
      DO UPDATE SET
        turn_id = excluded.turn_id,
        plan_markdown = excluded.plan_markdown,
        implemented_at = excluded.implemented_at,
        implementation_thread_id = excluded.implementation_thread_id,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at
    `,
  });

  const listRows = SqlSchema.findAll({
    Request: ListProjectionThreadSubagentProposedPlansInput,
    Result: ProjectionThreadSubagentProposedPlan,
    execute: ({ threadId, subagentId }) => sql`
      SELECT
        thread_id AS "threadId",
        subagent_id AS "subagentId",
        plan_id AS "planId",
        turn_id AS "turnId",
        plan_markdown AS "planMarkdown",
        implemented_at AS "implementedAt",
        implementation_thread_id AS "implementationThreadId",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM projection_thread_subagent_proposed_plans
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
      ORDER BY created_at ASC, plan_id ASC
    `,
  });

  const deleteRows = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentProposedPlansInput,
    execute: ({ threadId, subagentId }) => sql`
      DELETE FROM projection_thread_subagent_proposed_plans
      WHERE thread_id = ${threadId}
        AND subagent_id = ${subagentId}
    `,
  });

  const deleteRowsByThread = SqlSchema.void({
    Request: DeleteProjectionThreadSubagentProposedPlansByThreadInput,
    execute: ({ threadId }) => sql`
      DELETE FROM projection_thread_subagent_proposed_plans
      WHERE thread_id = ${threadId}
    `,
  });

  const upsert: ProjectionThreadSubagentProposedPlanRepositoryShape["upsert"] = (row) =>
    upsertRow(row).pipe(
      Effect.mapError(
        toPersistenceSqlError("ProjectionThreadSubagentProposedPlanRepository.upsert:query"),
      ),
    );

  const listBySubagentId: ProjectionThreadSubagentProposedPlanRepositoryShape["listBySubagentId"] =
    (input) =>
      listRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionThreadSubagentProposedPlanRepository.listBySubagentId:query",
          ),
        ),
      );

  const deleteBySubagentId: ProjectionThreadSubagentProposedPlanRepositoryShape["deleteBySubagentId"] =
    (input) =>
      deleteRows(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionThreadSubagentProposedPlanRepository.deleteBySubagentId:query",
          ),
        ),
      );

  const deleteByThreadId: ProjectionThreadSubagentProposedPlanRepositoryShape["deleteByThreadId"] =
    (input) =>
      deleteRowsByThread(input).pipe(
        Effect.mapError(
          toPersistenceSqlError(
            "ProjectionThreadSubagentProposedPlanRepository.deleteByThreadId:query",
          ),
        ),
      );

  return {
    upsert,
    listBySubagentId,
    deleteBySubagentId,
    deleteByThreadId,
  } satisfies ProjectionThreadSubagentProposedPlanRepositoryShape;
});

export const ProjectionThreadSubagentProposedPlanRepositoryLive = Layer.effect(
  ProjectionThreadSubagentProposedPlanRepository,
  makeProjectionThreadSubagentProposedPlanRepository,
);
