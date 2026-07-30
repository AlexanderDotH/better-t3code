import { SubagentId, ThreadId, type OrchestrationSubagentSummary } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const threadId = ThreadId.make("thread-subagent-query");
const subagentId = SubagentId.make("agent-subagent-query");
const createdAt = "2026-07-30T11:00:00.000Z";
const updatedAt = "2026-07-30T11:00:01.000Z";

const expectedSummary: OrchestrationSubagentSummary = {
  id: subagentId,
  providerThreadId: "provider-agent-subagent-query",
  parentId: null,
  path: "/root/query",
  name: "query",
  nickname: "query",
  role: "worker",
  task: "Test lazy queries",
  model: "gpt-5.6",
  reasoningEffort: "ultra",
  depth: 1,
  status: "running",
  statusMessage: "Reading projections",
  latestProgress: {
    kind: "query",
    summary: "Reading projection rows",
    detail: null,
    createdAt: updatedAt,
  },
  latestTurn: null,
  startedAt: createdAt,
  updatedAt,
  completedAt: null,
};

const TestLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("ProjectionSnapshotQuery subagent details", (it) => {
  it.effect("hydrates root summaries and lazily assembles one child transcript", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;

      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          branch,
          worktree_path,
          latest_turn_id,
          latest_user_message_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan,
          created_at,
          updated_at,
          archived_at,
          deleted_at
        )
        VALUES (
          ${threadId},
          'project-subagent-query',
          'Subagent query',
          '{"instanceId":"codex","model":"gpt-5.6"}',
          'full-access',
          'default',
          NULL,
          NULL,
          NULL,
          NULL,
          0,
          0,
          0,
          ${createdAt},
          ${updatedAt},
          NULL,
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_subagents (
          thread_id,
          subagent_id,
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
          ${threadId},
          ${subagentId},
          ${expectedSummary.providerThreadId},
          NULL,
          ${expectedSummary.path},
          ${expectedSummary.name},
          ${expectedSummary.nickname},
          ${expectedSummary.role},
          ${expectedSummary.task},
          ${expectedSummary.model},
          ${expectedSummary.reasoningEffort},
          ${expectedSummary.depth},
          ${expectedSummary.status},
          ${expectedSummary.statusMessage},
          ${JSON.stringify(expectedSummary.latestProgress)},
          NULL,
          ${createdAt},
          ${updatedAt},
          NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_subagent_messages (
          thread_id,
          subagent_id,
          message_id,
          turn_id,
          role,
          text,
          attachments_json,
          is_streaming,
          created_at,
          updated_at
        )
        VALUES (
          ${threadId},
          ${subagentId},
          'message-subagent-query',
          'turn-subagent-query',
          'assistant',
          'lazy child output',
          NULL,
          0,
          ${updatedAt},
          ${updatedAt}
        )
      `;
      yield* sql`
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
          ${threadId},
          ${subagentId},
          'plan-subagent-query',
          'turn-subagent-query',
          '# Lazy plan',
          NULL,
          NULL,
          ${updatedAt},
          ${updatedAt}
        )
      `;
      yield* sql`
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
          ${threadId},
          ${subagentId},
          'activity-subagent-query',
          'turn-subagent-query',
          'info',
          'command.completed',
          'Focused query completed',
          '{"exitCode":0}',
          3,
          ${updatedAt}
        )
      `;

      const root = yield* query.getThreadDetailById(threadId);
      assert.equal(root._tag, "Some");
      if (root._tag === "Some") {
        assert.deepEqual(root.value.subagents, [expectedSummary]);
        assert.deepEqual(root.value.messages, []);
        assert.deepEqual(root.value.proposedPlans, []);
        assert.deepEqual(root.value.activities, []);
      }

      const detail = yield* query.getSubagentDetailById(threadId, subagentId);
      assert.equal(detail._tag, "Some");
      if (detail._tag === "Some") {
        assert.deepEqual(detail.value, {
          ...expectedSummary,
          messages: [
            {
              id: "message-subagent-query",
              turnId: "turn-subagent-query",
              role: "assistant",
              text: "lazy child output",
              streaming: false,
              createdAt: updatedAt,
              updatedAt,
            },
          ],
          proposedPlans: [
            {
              id: "plan-subagent-query",
              turnId: "turn-subagent-query",
              planMarkdown: "# Lazy plan",
              implementedAt: null,
              implementationThreadId: null,
              createdAt: updatedAt,
              updatedAt,
            },
          ],
          activities: [
            {
              id: "activity-subagent-query",
              turnId: "turn-subagent-query",
              tone: "info",
              kind: "command.completed",
              summary: "Focused query completed",
              payload: { exitCode: 0 },
              sequence: 3,
              createdAt: updatedAt,
            },
          ],
        });
      }

      const snapshot = yield* query.getSubagentDetailSnapshot(threadId, subagentId);
      assert.equal(snapshot._tag, "Some");
      if (snapshot._tag === "Some") {
        assert.equal(snapshot.value.snapshotSequence, 0);
        assert.equal(snapshot.value.threadId, threadId);
        assert.deepEqual(snapshot.value.subagent, detail._tag === "Some" ? detail.value : null);
      }

      const missing = yield* query.getSubagentDetailById(
        threadId,
        SubagentId.make("agent-missing"),
      );
      assert.equal(missing._tag, "None");
      const missingSnapshot = yield* query.getSubagentDetailSnapshot(
        threadId,
        SubagentId.make("agent-missing"),
      );
      assert.equal(missingSnapshot._tag, "None");
    }),
  );
});
