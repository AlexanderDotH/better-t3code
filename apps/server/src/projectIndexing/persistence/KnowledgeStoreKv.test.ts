// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { expect } from "vite-plus/test";

import { openExistingKnowledgeKvStore, openKnowledgeKvStore } from "./KnowledgeStoreKv.ts";
import { KNOWLEDGE_STORE_APPLICATION_ID } from "./KnowledgeStoreSchema.ts";

it.live("persists checkpoints while lease renewal and settings writes overlap", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-kv-checkpoints-"))),
        (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
      );
      const store = yield* openKnowledgeKvStore({ workspaceRoot: root });
      const settings = { ...(yield* store.getSettings()), enabled: true };
      yield* store.setSettings(settings);
      const lease = yield* store.acquireLease("checkpoint-test");
      const { revision } = yield* store.beginGeneration({
        lease,
        expectedRevision: 0,
        idempotencyKey: "concurrent-checkpoints",
      });
      for (let checkpoint = 0; checkpoint < 20; checkpoint++) {
        const metadataJson = `{"knowledgeFormat":"static-v1","checkpoint":${checkpoint}}`;
        yield* Effect.all(
          [
            store.renewLease(lease),
            store.setGenerationMetadata({ lease, revision, metadataJson }),
            store.setSettings(settings),
          ],
          { concurrency: "unbounded" },
        );
        expect(yield* store.getGenerationMetadata(revision)).toBe(metadataJson);
        expect((yield* store.getState()).status).toBe("running");
      }
      yield* store.publishGeneration({ lease, revision });
      expect((yield* store.getState()).publishedRevision).toBe(revision);
    }),
  ),
);

it.effect("publishes and reopens project knowledge with a checkpointed next generation", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const root = yield* Effect.acquireRelease(
        Effect.sync(() =>
          NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-kv-store-")),
        ),
        (path) => Effect.sync(() => NodeFS.rmSync(path, { recursive: true, force: true })),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeKvStore({ workspaceRoot: root });
          const settings = yield* store.setSettings({
            ...(yield* store.getSettings()),
            enabled: true,
          });
          expect(settings.enabled).toBe(true);
          const mainDatabasePath = NodePath.join(root, "state.sqlite");
          const mainDatabase = new NodeSqlite.DatabaseSync(mainDatabasePath);
          mainDatabase.exec("CREATE TABLE threads(id TEXT PRIMARY KEY)");
          mainDatabase.close();
          const legacyDatabase = new NodeSqlite.DatabaseSync(store.workspace.databasePath);
          legacyDatabase.exec(
            "CREATE TABLE knowledge_state(singleton INTEGER PRIMARY KEY, workspace_id TEXT)",
          );
          legacyDatabase
            .prepare("INSERT INTO knowledge_state VALUES (1, ?)")
            .run(store.workspace.workspaceId);
          legacyDatabase.exec(`PRAGMA application_id = ${KNOWLEDGE_STORE_APPLICATION_ID}`);
          legacyDatabase.close();
          const lease = yield* store.acquireLease("writer");
          const first = yield* store.beginGeneration({
            lease,
            expectedRevision: 0,
            idempotencyKey: "one",
          });
          expect(first.revision).toBe(1);
          yield* store.setGenerationMetadata({
            lease,
            revision: 1,
            metadataJson: '{"knowledgeFormat":"static-v1"}',
          });
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              files: [
                {
                  path: "source.ts",
                  contentHash: "hash",
                  language: "typescript",
                  bytes: 12,
                  classification: "source",
                  status: "indexed",
                  configDependencies: [],
                },
              ],
              entities: [
                {
                  id: "symbol",
                  filePath: "source.ts",
                  sourceHash: "hash",
                  kind: "function",
                  name: "symbol",
                  qualifiedName: "symbol",
                  language: "typescript",
                  range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
                  provenance: "parser",
                  freshness: "current",
                  evidenceIds: [],
                },
              ],
            },
          });
          expect(yield* store.countFiles(1)).toBe(1);
          expect((yield* store.aggregateCoverage(1)).totalEntities).toBe(1);
          expect(
            (yield* store.searchRecords({
              revision: 1,
              query: "symbol",
              kinds: ["entities"],
            })).items.map((hit) => hit.record.id),
          ).toEqual(["symbol"]);
          yield* store.publishGeneration({ lease, revision: 1 });
          expect(NodeFS.existsSync(store.workspace.databasePath)).toBe(false);
          expect(NodeFS.existsSync(mainDatabasePath)).toBe(true);
          const second = yield* store.beginGeneration({
            lease,
            expectedRevision: 1,
            idempotencyKey: "two",
          });
          expect(second.revision).toBe(2);
          expect((yield* store.getRecord("entities", "symbol", 2))?.id).toBe("symbol");
          expect((yield* store.listRecords({ kind: "files", revision: 2 })).items).toHaveLength(1);
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openExistingKnowledgeKvStore({ workspaceRoot: root });
          expect(store).not.toBeNull();
          expect((yield* store!.getRecord("entities", "symbol", 1))?.id).toBe("symbol");
          expect((yield* store!.getState()).publishedRevision).toBe(1);
          expect((yield* store!.getSettings()).enabled).toBe(true);
        }),
      );
    }),
  ),
);
