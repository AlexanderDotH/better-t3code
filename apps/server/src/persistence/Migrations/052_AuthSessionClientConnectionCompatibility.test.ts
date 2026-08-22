import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";
import Migration052 from "./052_AuthSessionClientConnectionCompatibility.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("052_AuthSessionClientConnectionCompatibility", (it) => {
  it.effect("adds nullable connection metadata after the immutable fork ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 51 });
      const executed = yield* runMigrations();
      assert.deepStrictEqual(
        executed.map(([id, name]) => [id, name]),
        [[52, "AuthSessionClientConnectionCompatibility"]],
      );

      yield* Migration052;
      yield* Migration052;

      const columns = yield* sql<{ readonly name: string; readonly notnull: number }>`
        PRAGMA table_info(auth_sessions)
      `;
      const surface = columns.find((column) => column.name === "client_surface");
      const appVersion = columns.find((column) => column.name === "client_app_version");

      assert.equal(surface?.name, "client_surface");
      assert.equal(surface?.notnull, 0);
      assert.equal(appVersion?.name, "client_app_version");
      assert.equal(appVersion?.notnull, 0);

      const integrity = yield* sql<Record<string, string>>`PRAGMA integrity_check`;
      assert.deepStrictEqual(
        integrity.map((row) => Object.values(row)[0]),
        ["ok"],
      );
    }),
  );
});
