import * as NodeServices from "@effect/platform-node/NodeServices";
import { ThreadId } from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { SqlitePersistenceMemory } from "../../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../../project/RepositoryIdentityResolver.ts";
import { ThreadTranscriptExport } from "../Services/ThreadTranscriptExport.ts";
import * as ThreadBackgroundLiveness from "../ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../ThreadPlanProgress.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "./ProjectionSnapshotQuery.ts";
import { ThreadTranscriptExportLive } from "./ThreadTranscriptExport.ts";

const queryLayer = OrchestrationProjectionSnapshotQueryLive.pipe(
  Layer.provide(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provideMerge(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
);

const transcriptExportLayer = ThreadTranscriptExportLive.pipe(
  Layer.provideMerge(queryLayer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(NodeServices.layer),
);

it.layer(transcriptExportLayer)("ThreadTranscriptExport persistence", (it) => {
  it.effect("exports rows beyond the browser's 512-message and 128-activity caps", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const exporter = yield* ThreadTranscriptExport;
      const threadId = ThreadId.make("thread-retention-regression");

      yield* sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (
          'project-retention-regression',
          'Retention regression',
          '/tmp/retention-regression',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          '[]',
          '2026-07-12T00:00:00.000Z',
          '2026-07-12T00:00:00.000Z',
          NULL
        )
      `;
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
        ) VALUES (
          ${threadId},
          'project-retention-regression',
          'Retention regression thread',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          NULL,
          '/tmp/retention-regression',
          NULL,
          NULL,
          0,
          0,
          0,
          '2026-07-12T00:00:00.000Z',
          '2026-07-12T00:00:00.000Z',
          NULL,
          NULL
        )
      `;

      for (let index = 0; index < 513; index += 1) {
        const timestamp = `2026-07-12T00:00:00.${String(index).padStart(3, "0")}Z`;
        yield* sql`
          INSERT INTO projection_thread_messages (
            message_id,
            thread_id,
            turn_id,
            role,
            text,
            attachments_json,
            is_streaming,
            created_at,
            updated_at
          ) VALUES (
            ${`message-${index}`},
            ${threadId},
            NULL,
            'user',
            ${`persisted message ${index}`},
            NULL,
            0,
            ${timestamp},
            ${timestamp}
          )
        `;
      }

      for (let index = 0; index < 129; index += 1) {
        const timestamp = `2026-07-12T00:01:00.${String(index).padStart(3, "0")}Z`;
        yield* sql`
          INSERT INTO projection_thread_activities (
            activity_id,
            thread_id,
            turn_id,
            tone,
            kind,
            summary,
            payload_json,
            sequence,
            created_at
          ) VALUES (
            ${`activity-${index}`},
            ${threadId},
            NULL,
            'info',
            'future.activity',
            ${`persisted activity ${index}`},
            ${`{"index":${index}}`},
            ${index},
            ${timestamp}
          )
        `;
      }

      const transcript = yield* exporter.exportThread(threadId);

      assert.include(transcript.content, "persisted message 0");
      assert.include(transcript.content, "persisted message 512");
      assert.include(transcript.content, "persisted activity 0");
      assert.include(transcript.content, "persisted activity 128");
    }),
  );
});
