import { ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";

const TestLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(TestLayer)("ProjectionSnapshotQuery fork history", (it) => {
  it.effect("rehydrates frozen history, provenance, search, and read-only checkpoints", () =>
    Effect.gen(function* () {
      const query = yield* ProjectionSnapshotQuery;
      const sql = yield* SqlClient.SqlClient;
      const threadId = ThreadId.make("thread-fork-snapshot");
      const sourceThreadId = ThreadId.make("thread-source-snapshot");
      const forkJson = JSON.stringify({
        provenance: {
          sourceThreadId,
          sourceTitle: "Source snapshot",
          boundary: { kind: "message", messageId: "message-source" },
          forkedAt: "2026-08-24T12:00:10.000Z",
        },
        workspace: {
          spec: {
            mode: "local",
            baseBranch: null,
            startFromOrigin: false,
            runSetupScript: false,
          },
          status: "pending",
          preparedAt: null,
          lastError: null,
        },
        handoff: {
          status: "pending",
          historyInputChars: 20,
          historyAttachmentCount: 0,
          remainingInputChars: 100,
          remainingAttachmentCount: 4,
          completedAt: null,
        },
      });

      yield* sql`
        INSERT INTO projection_projects (
          project_id, title, workspace_root, default_model_selection_json,
          scripts_json, created_at, updated_at, deleted_at
        ) VALUES (
          'project-fork-snapshot', 'Fork project', '/tmp/fork-project', NULL,
          '[]', '2026-08-24T12:00:00.000Z', '2026-08-24T12:00:00.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, branch, worktree_path, latest_turn_id,
          latest_user_message_at, pending_approval_count, pending_user_input_count,
          has_actionable_proposed_plan, fork_json, created_at, updated_at, deleted_at
        ) VALUES (
          ${threadId}, 'project-fork-snapshot', 'Source snapshot (fork)',
          '{"instanceId":"codex","model":"gpt-5.6-codex"}', 'full-access',
          'default', NULL, NULL, NULL, NULL, 0, 0, 0, ${forkJson},
          '2026-08-24T12:00:10.000Z', '2026-08-24T12:00:10.000Z', NULL
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_messages (
          message_id, thread_id, turn_id, role, text, is_streaming,
          created_at, updated_at, history_origin_json
        ) VALUES (
          'message-fork-snapshot', ${threadId}, 'turn-fork-snapshot', 'user',
          'searchable inherited needle', 0,
          '2026-08-24T12:00:01.000Z', '2026-08-24T12:00:01.000Z',
          '{"sourceThreadId":"thread-source-snapshot","sourceId":"message-source","ordinal":0}'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_proposed_plans (
          plan_id, thread_id, turn_id, plan_markdown, implemented_at,
          implementation_thread_id, created_at, updated_at, history_origin_json
        ) VALUES (
          'plan-fork-snapshot', ${threadId}, 'turn-fork-snapshot', '# Frozen plan',
          NULL, NULL, '2026-08-24T12:00:02.000Z', '2026-08-24T12:00:02.000Z',
          '{"sourceThreadId":"thread-source-snapshot","sourceId":"plan-source","ordinal":1}'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_activities (
          activity_id, thread_id, turn_id, tone, kind, summary, payload_json,
          sequence, created_at, history_origin_json
        ) VALUES (
          'activity-fork-snapshot', ${threadId}, 'turn-fork-snapshot', 'tool',
          'tool.completed', 'Frozen tool result', '{}', 3,
          '2026-08-24T12:00:03.000Z',
          '{"sourceThreadId":"thread-source-snapshot","sourceId":"activity-source","ordinal":2}'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_subagents (
          thread_id, subagent_id, origin, provider_thread_id, name, depth, status,
          started_at, updated_at, completed_at, history_origin_json
        ) VALUES (
          ${threadId}, 'subagent-fork-snapshot', 'provider-native', 'provider-subagent',
          'Frozen subagent', 1, 'completed', '2026-08-24T12:00:03.000Z',
          '2026-08-24T12:00:04.000Z', '2026-08-24T12:00:04.000Z',
          '{"sourceThreadId":"thread-source-snapshot","sourceId":"subagent-source","ordinal":3}'
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, pending_message_id, assistant_message_id, state,
          requested_at, started_at, completed_at, checkpoint_files_json,
          history_origin_json, history_checkpoint_turn_count, history_checkpoint_ref,
          history_checkpoint_status, history_checkpoint_files_json
        ) VALUES (
          ${threadId}, 'turn-fork-snapshot', 'message-fork-snapshot', NULL, 'completed',
          '2026-08-24T12:00:01.000Z', '2026-08-24T12:00:01.000Z',
          '2026-08-24T12:00:05.000Z', '[]',
          '{"sourceThreadId":"thread-source-snapshot","sourceId":"turn-source","ordinal":4}',
          1, 'refs/t3/checkpoints/thread-source-snapshot/turn/1', 'ready', '[]'
        )
      `;
      yield* sql`
        INSERT INTO projection_thread_fork_checkpoints (
          thread_id, turn_id, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
          checkpoint_files_json, assistant_message_id, completed_at, history_origin_json
        ) VALUES (
          ${threadId}, 'turn-fork-snapshot', 1,
          'refs/t3/checkpoints/thread-source-snapshot/turn/1', 'ready', '[]', NULL,
          '2026-08-24T12:00:05.000Z',
          '{"sourceThreadId":"thread-source-snapshot","sourceId":"checkpoint-source","ordinal":5}'
        )
      `;
      yield* sql`
        INSERT INTO projection_turns (
          thread_id, turn_id, assistant_message_id, state, requested_at, started_at,
          completed_at, checkpoint_turn_count, checkpoint_ref, checkpoint_status,
          checkpoint_files_json
        ) VALUES (
          ${threadId}, 'turn-native', NULL, 'completed',
          '2026-08-24T12:01:00.000Z', '2026-08-24T12:01:00.000Z',
          '2026-08-24T12:01:01.000Z', 2,
          'refs/t3/checkpoints/thread-fork-snapshot/turn/2', 'ready', '[]'
        )
      `;

      const detail = yield* query.getThreadDetailById(threadId);
      assert.isTrue(Option.isSome(detail));
      if (Option.isSome(detail)) {
        assert.equal(detail.value.fork?.provenance.sourceThreadId, sourceThreadId);
        assert.equal(detail.value.messages[0]?.historyOrigin?.ordinal, 0);
        assert.equal(detail.value.proposedPlans[0]?.historyOrigin?.ordinal, 1);
        assert.equal(detail.value.activities[0]?.historyOrigin?.ordinal, 2);
        assert.equal(detail.value.subagents[0]?.historyOrigin?.ordinal, 3);
        assert.deepStrictEqual(
          detail.value.checkpoints.map((checkpoint) => [
            checkpoint.checkpointTurnCount,
            checkpoint.historyOrigin?.ordinal ?? null,
          ]),
          [
            [1, 5],
            [2, null],
          ],
        );
      }

      const snapshot = yield* query.getSnapshot();
      const snapshotThread = snapshot.threads.find((thread) => thread.id === threadId);
      assert.equal(snapshotThread?.fork?.provenance.sourceThreadId, sourceThreadId);
      assert.equal(snapshotThread?.messages[0]?.historyOrigin?.ordinal, 0);
      assert.equal(snapshotThread?.checkpoints[0]?.historyOrigin?.ordinal, 5);

      const shell = yield* query.getThreadShellById(threadId);
      assert.isTrue(Option.isSome(shell));
      if (Option.isSome(shell)) {
        assert.equal(shell.value.fork?.handoff.remainingInputChars, 100);
      }

      const history = yield* query.getThreadForkHistory(threadId);
      assert.isTrue(Option.isSome(history));
      if (Option.isSome(history)) {
        assert.deepStrictEqual(
          [
            ...history.value.messages,
            ...history.value.proposedPlans,
            ...history.value.activities,
            ...history.value.subagents,
            ...history.value.turns,
            ...history.value.checkpoints,
          ]
            .map((entry) => entry.historyOrigin.ordinal)
            .toSorted((left, right) => left - right),
          [0, 1, 2, 3, 4, 5],
        );
        assert.equal(history.value.turns[0]?.checkpointTurnCount, 1);
      }

      const search = yield* query.searchThreads({ query: "inherited needle" });
      assert.equal(search.matches[0]?.threadId, threadId);

      const checkpointContext = yield* query.getThreadCheckpointContext(threadId);
      assert.isTrue(Option.isSome(checkpointContext));
      if (Option.isSome(checkpointContext)) {
        assert.deepStrictEqual(
          checkpointContext.value.checkpoints.map((checkpoint) => [
            checkpoint.checkpointTurnCount,
            checkpoint.historyOrigin?.sourceThreadId ?? null,
          ]),
          [
            [1, sourceThreadId],
            [2, null],
          ],
        );
      }

      const inheritedDiff = yield* query.getFullThreadDiffContext(threadId, 1);
      assert.isTrue(Option.isSome(inheritedDiff));
      if (Option.isSome(inheritedDiff)) {
        assert.equal(inheritedDiff.value.baselineCheckpointThreadId, sourceThreadId);
      }
      const nativeDiff = yield* query.getFullThreadDiffContext(threadId, 2);
      assert.isTrue(Option.isSome(nativeDiff));
      if (Option.isSome(nativeDiff)) {
        assert.equal(nativeDiff.value.baselineCheckpointThreadId, threadId);
        assert.equal(nativeDiff.value.latestCheckpointTurnCount, 2);
      }
    }),
  );
});
