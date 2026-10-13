import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";

import { runMigrations } from "./LegacyForkMigrations.ts";
import migration from "./065_ProjectionMessageReplyTopics.ts";

it.layer(NodeSqliteClient.layerMemory())("reply topic migration", (it) => {
  it.effect("adds nullable reply metadata without changing existing transcript rows", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 60 });
      yield* sql`
        INSERT INTO projection_thread_subagent_messages (
          thread_id, subagent_id, message_id, role, text, is_streaming, created_at, updated_at
        ) VALUES ('thread', 'native', 'message', 'assistant', 'Existing output', 0,
          '2026-10-13T10:00:00.000Z', '2026-10-13T10:00:00.000Z')
      `;
      yield* migration;
      yield* migration;
      const rows = yield* sql`
        SELECT text, reply_to_json, context_json, reply_topic_id FROM projection_thread_subagent_messages
      `;
      assert.deepEqual(rows, [
        { text: "Existing output", reply_to_json: null, context_json: null, reply_topic_id: null },
      ]);
    }),
  );
});
