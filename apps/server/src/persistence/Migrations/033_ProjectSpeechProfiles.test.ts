import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration033 from "./033_ProjectSpeechProfiles.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("033_ProjectSpeechProfiles", (it) => {
  it.effect("creates the project speech profile table with the complete persisted shape", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* Migration033;

      const columns = yield* sql<{
        readonly name: string;
        readonly notnull: number;
        readonly pk: number;
      }>`PRAGMA table_info(project_speech_profiles)`;

      assert.deepStrictEqual(
        columns.map(({ name }) => name),
        [
          "project_id",
          "project_title",
          "workspace_root",
          "repository_key",
          "source",
          "context_prompt",
          "keyterms_json",
          "technologies_json",
          "created_at",
          "updated_at",
          "warning",
        ],
      );
      assert.strictEqual(columns.find(({ name }) => name === "project_id")?.pk, 1);
      assert.strictEqual(columns.find(({ name }) => name === "repository_key")?.notnull, 0);
      assert.strictEqual(columns.find(({ name }) => name === "warning")?.notnull, 0);
    }),
  );
});
