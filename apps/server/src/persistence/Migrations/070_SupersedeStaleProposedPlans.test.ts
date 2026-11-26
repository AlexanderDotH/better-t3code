import { assert, it } from "@effect/vitest";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import migration from "./070_SupersedeStaleProposedPlans.ts";

const layer = it.layer(NodeSqliteClient.layer({ filename: ":memory:" }));
const requestedAt = "2026-11-23T20:00:00.000Z";

layer("070_SupersedeStaleProposedPlans", (it) => {
  it.effect("supersedes active proposed plans that a later run replaced", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      // A fresh database runs this fork migration before the V2 tables exist.
      yield* runMigrations();
      const insertRun = (threadId: string, ordinal: number) => sql`
        INSERT INTO orchestration_v2_projection_runs (
          run_id, thread_id, ordinal, provider, status, requested_at, payload_json
        ) VALUES (
          ${`${threadId}:run:${ordinal}`}, ${threadId}, ${ordinal}, 'codex', 'completed',
          ${requestedAt}, '{}'
        )
      `;
      const insertPlan = (
        threadId: string,
        ordinal: number,
        status: string,
        options: { readonly kind?: string; readonly deepPlan?: boolean } = {},
      ) => {
        const planId = `${threadId}:plan:${ordinal}`;
        const payload = {
          id: planId,
          threadId,
          runId: `${threadId}:run:${ordinal}`,
          nodeId: `${threadId}:node:${ordinal}`,
          kind: options.kind ?? "proposed_plan",
          status,
          markdown: "# Plan",
          ...(options.deepPlan ? { deepPlan: { runId: "deep", planVersion: 1 } } : {}),
        };
        return sql`
          INSERT INTO orchestration_v2_projection_plans (
            plan_id, thread_id, run_id, node_id, kind, status, payload_json
          ) VALUES (
            ${planId}, ${threadId}, ${payload.runId}, ${payload.nodeId}, ${payload.kind},
            ${status}, ${JSON.stringify(payload)}
          )
        `;
      };
      for (const ordinal of [1, 2, 3]) {
        yield* insertRun("revised", ordinal);
        yield* insertRun("single", ordinal);
        yield* insertRun("deep", ordinal);
        yield* insertRun("todo", ordinal);
      }
      // An older draft outlived the revision that was implemented.
      yield* insertPlan("revised", 1, "active");
      yield* insertPlan("revised", 2, "completed");
      yield* insertPlan("single", 2, "active");
      yield* insertPlan("deep", 1, "active", { deepPlan: true });
      yield* insertPlan("deep", 2, "completed");
      yield* insertPlan("todo", 1, "active");
      yield* insertPlan("todo", 3, "active", { kind: "todo_list" });

      yield* migration;
      const plans = yield* sql<{
        readonly plan_id: string;
        readonly status: string;
        readonly payload_status: string;
      }>`
        SELECT plan_id, status, json_extract(payload_json, '$.status') AS payload_status
        FROM orchestration_v2_projection_plans ORDER BY plan_id
      `;
      assert.deepStrictEqual(
        plans.map((plan) => [plan.plan_id, plan.status, plan.payload_status]),
        [
          ["deep:plan:1", "active", "active"],
          ["deep:plan:2", "completed", "completed"],
          ["revised:plan:1", "superseded", "superseded"],
          ["revised:plan:2", "completed", "completed"],
          ["single:plan:2", "active", "active"],
          ["todo:plan:1", "active", "active"],
          ["todo:plan:3", "active", "active"],
        ],
      );
    }),
  );
});
