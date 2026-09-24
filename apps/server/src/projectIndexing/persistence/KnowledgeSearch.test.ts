// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it } from "@effect/vitest";
import type { ProjectEntityV1, ProjectImportV1, ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";

import { openKnowledgeStore, type KnowledgeStore } from "./KnowledgeStore.ts";

const roots: string[] = [];
const root = () => {
  const path = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-static-search-"));
  roots.push(path);
  return path;
};
afterEach(() => {
  for (const path of roots.splice(0)) NodeFS.rmSync(path, { recursive: true, force: true });
});

const range = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 24 };
const file = (path: string, contentHash = "hash"): ProjectSourceFileV1 => ({
  path,
  contentHash,
  language: "typescript",
  bytes: 24,
  classification: "source",
  status: "indexed",
  configDependencies: [],
});
const entity = (id: string, path: string, name = id): ProjectEntityV1 => ({
  id,
  filePath: path,
  sourceHash: "hash",
  kind: "function",
  name,
  qualifiedName: name,
  signature: `${name}(request: Request): Response`,
  language: "typescript",
  range,
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});
const importRecord = (
  id: string,
  resolution: ProjectImportV1["resolution"] = "workspace",
): ProjectImportV1 => ({
  id,
  filePath: "src/main.ts",
  sourceHash: "hash",
  range,
  importText: "import { decodeRequest } from './decoder'",
  specifier: "./decoder",
  resolution,
  ...(resolution === "workspace" ? { targetPath: "src/decoder.ts" } : {}),
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});

function withStore<A, E, R>(run: (store: KnowledgeStore) => Effect.Effect<A, E, R>) {
  const workspaceRoot = root();
  return Effect.scoped(
    Effect.gen(function* () {
      const store = yield* openKnowledgeStore({ workspaceRoot });
      return yield* run(store);
    }),
  );
}

describe("static knowledge search", () => {
  it.effect("ranks exact symbols above task words and excludes source excerpts", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "static",
        });
        yield* store.setGenerationMetadata({
          lease,
          revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: {
            files: [file("src/request.ts"), file("src/fix.ts"), file("src/stale.ts")],
            entities: [
              entity("decoder", "src/request.ts", "decodeRequest"),
              {
                ...entity("noise", "src/fix.ts", "fixFormatter"),
                signature: "fixFormatter(): string",
              },
              { ...entity("stale", "src/stale.ts", "staleMarker"), freshness: "stale" },
            ],
            evidence: [
              {
                id: "evidence",
                filePath: "src/request.ts",
                sourceHash: "hash",
                range,
                excerpt: "secret excerpt only appears in source",
                provenance: "parser",
              },
            ],
          },
        });
        const results = yield* store.searchRecords({
          revision,
          query: "Fix decodeRequest",
          kinds: ["entities"],
        });
        expect(results.items[0]?.record.id).toBe("decoder");
        expect(results.items.some((hit) => hit.record.id === "noise")).toBe(false);
        expect(
          (yield* store.searchRecords({ revision, query: "secret excerpt", kinds: ["entities"] }))
            .items,
        ).toEqual([]);
        expect(
          (yield* store.searchRecords({ revision, query: "staleMarker", kinds: ["entities"] }))
            .items,
        ).toEqual([]);
        expect(
          (yield* store.searchRecords({
            revision,
            query: "staleMarker",
            kinds: ["entities"],
            includeStale: true,
          })).items.map((hit) => hit.record.id),
        ).toEqual(["stale"]);
        expect(yield* store.isStaticRevision(revision)).toBe(true);
      }),
    ),
  );

  it.effect("keeps scoped matches when a broad term matches thousands of other records", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "static",
        });
        yield* store.setGenerationMetadata({
          lease,
          revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: {
            files: [file("src/noise.ts"), file("src/scoped/target.ts")],
            entities: [
              ...Array.from({ length: 2_050 }, (_, index) =>
                entity(`noise-${String(index).padStart(4, "0")}`, "src/noise.ts", "noise"),
              ),
              entity("target", "src/scoped/target.ts", "noise"),
            ],
          },
        });
        const results = yield* store.searchRecords({
          revision,
          query: "noise",
          kinds: ["entities"],
          filePathPrefixes: ["src/scoped"],
        });
        expect(results.items.map((hit) => hit.record.id)).toEqual(["target"]);
      }),
    ),
  );

  it.effect("copies imports and removes stale target edges on reset or deletion", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const first = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "first",
        });
        yield* store.setGenerationMetadata({
          lease,
          revision: first.revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        yield* store.applyBatch({
          lease,
          revision: first.revision,
          batch: {
            files: [file("src/main.ts"), file("src/decoder.ts")],
            imports: [importRecord("edge")],
          },
        });
        expect(
          (yield* store.listRecords({
            kind: "imports",
            revision: first.revision,
            filePath: "src/decoder.ts",
          })).items,
        ).toHaveLength(1);
        expect(
          (yield* store.searchRecords({
            revision: first.revision,
            query: "decoder",
            kinds: ["imports"],
          })).items,
        ).toHaveLength(1);
        expect((yield* store.aggregateCoverage(first.revision)).resolvedImports).toBe(1);
        expect(
          (yield* store.getAffectedFilePaths({
            revision: first.revision,
            changedPaths: ["src/decoder.ts"],
          })).items,
        ).toContain("src/main.ts");
        yield* store.publishGeneration({ lease, revision: first.revision });

        const second = yield* store.beginGeneration({
          lease,
          expectedRevision: first.revision,
          idempotencyKey: "second",
        });
        yield* store.setGenerationMetadata({
          lease,
          revision: second.revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        expect(
          (yield* store.listRecords({ kind: "imports", revision: second.revision })).items,
        ).toHaveLength(1);
        yield* store.applyBatch({
          lease,
          revision: second.revision,
          batch: {},
          resetStructuralFilePaths: ["src/decoder.ts"],
        });
        expect(
          (yield* store.listRecords({ kind: "imports", revision: second.revision })).items,
        ).toEqual([]);
        expect(
          (yield* store.searchRecords({
            revision: second.revision,
            query: "decoder",
            kinds: ["imports"],
          })).items,
        ).toEqual([]);
        yield* store.applyBatch({
          lease,
          revision: second.revision,
          batch: { files: [file("src/decoder.ts")], imports: [importRecord("edge")] },
        });
        yield* store.applyBatch({
          lease,
          revision: second.revision,
          batch: {},
          removeFilePaths: ["src/decoder.ts"],
        });
        expect(
          (yield* store.listRecords({ kind: "imports", revision: second.revision })).items,
        ).toEqual([]);
        expect(
          (yield* store.searchRecords({
            revision: second.revision,
            query: "decoder",
            kinds: ["imports"],
          })).items,
        ).toEqual([]);
        expect(
          (yield* store.listRecords({ kind: "imports", revision: first.revision })).items,
        ).toHaveLength(1);
      }),
    ),
  );

  it.effect("paginates tied search scores by stable kind and id", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "static",
        });
        yield* store.setGenerationMetadata({
          lease,
          revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: {
            files: [file("src/main.ts")],
            entities: [
              entity("a", "src/main.ts", "decodeAlpha"),
              entity("b", "src/main.ts", "decodeBeta"),
            ],
          },
        });
        const first = yield* store.searchRecords({
          revision,
          query: "decode",
          kinds: ["entities"],
          limit: 1,
        });
        expect(first.items).toHaveLength(1);
        expect(first.nextCursor).not.toBeNull();
        const second = yield* store.searchRecords({
          revision,
          query: "decode",
          kinds: ["entities"],
          limit: 1,
          after: first.nextCursor!,
        });
        expect(second.items).toHaveLength(1);
        expect(second.items[0]?.record.id).not.toBe(first.items[0]?.record.id);
        expect(second.nextCursor).toBeNull();
      }),
    ),
  );

  it.effect("does not search legacy AI revisions", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "legacy",
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: { files: [file("src/main.ts")], entities: [entity("legacy", "src/main.ts")] },
        });
        expect(yield* store.isStaticRevision(revision)).toBe(false);
        expect(
          (yield* store.searchRecords({ revision, query: "legacy", kinds: ["entities"] })).items,
        ).toEqual([]);
      }),
    ),
  );

  it.effect("retires legacy generated records only after a static publication", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const legacy = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "legacy",
        });
        yield* store.applyBatch({
          lease,
          revision: legacy.revision,
          batch: { files: [file("src/main.ts")], entities: [entity("old", "src/main.ts")] },
        });
        yield* store.publishGeneration({ lease, revision: legacy.revision });
        const next = yield* store.beginGeneration({
          lease,
          expectedRevision: legacy.revision,
          idempotencyKey: "static",
          copyPublished: false,
        });
        yield* store.setGenerationMetadata({
          lease,
          revision: next.revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        yield* store.applyBatch({
          lease,
          revision: next.revision,
          batch: { files: [file("src/main.ts")], entities: [entity("current", "src/main.ts")] },
        });
        const before = new NodeSqlite.DatabaseSync(store.workspace.databasePath, {
          readOnly: true,
        });
        expect(
          before.prepare("SELECT COUNT(*) AS count FROM knowledge_records WHERE revision = 1").get()
            ?.count,
        ).toBeGreaterThan(0);
        before.close();
        yield* store.publishGeneration({ lease, revision: next.revision });
        const after = new NodeSqlite.DatabaseSync(store.workspace.databasePath, { readOnly: true });
        expect(
          after.prepare("SELECT COUNT(*) AS count FROM knowledge_records WHERE revision = 1").get()
            ?.count,
        ).toBe(0);
        expect(
          after
            .prepare("SELECT COUNT(*) AS count FROM knowledge_artifacts WHERE revision = 1")
            .get()?.count,
        ).toBe(0);
        expect(
          after.prepare("SELECT views_path FROM knowledge_generations WHERE revision = 1").get()
            ?.views_path,
        ).toBeNull();
        expect(
          after.prepare("SELECT COUNT(*) AS count FROM knowledge_records WHERE revision = 2").get()
            ?.count,
        ).toBeGreaterThan(0);
        after.close();
      }),
    ),
  );

  it.effect("backfills metadata search after an additive schema upgrade", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspaceRoot = root();
        const store = yield* openKnowledgeStore({ workspaceRoot });
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "static",
        });
        yield* store.setGenerationMetadata({
          lease,
          revision,
          metadataJson: '{"knowledgeFormat":"static-v1"}',
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: {
            files: [file("src/main.ts")],
            entities: [entity("decodeRequest", "src/main.ts")],
          },
        });
        yield* store.publishGeneration({ lease, revision });
        const databasePath = store.workspace.databasePath;
        const database = new NodeSqlite.DatabaseSync(databasePath);
        database.exec(
          "DROP TRIGGER knowledge_search_insert; DROP TRIGGER knowledge_search_update; DROP TRIGGER knowledge_search_delete; DROP VIEW knowledge_search_projection; DROP TABLE knowledge_record_fts; DROP TABLE knowledge_search_keys; DROP TABLE knowledge_search_state",
        );
        database.close();
        const reopened = yield* openKnowledgeStore({ workspaceRoot });
        const results = yield* reopened.searchRecords({
          revision,
          query: "decodeRequest",
          kinds: ["entities"],
        });
        expect(results.items.map((hit) => hit.record.id)).toEqual(["decodeRequest"]);
      }),
    ),
  );

  it.effect("keeps FTS matches linked after SQLite VACUUM changes internal rowids", () =>
    Effect.gen(function* () {
      const workspaceRoot = root();
      const databasePath = yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot });
          const lease = yield* store.acquireLease("writer");
          const { revision } = yield* store.beginGeneration({
            lease,
            expectedRevision: 0,
            idempotencyKey: "static",
          });
          yield* store.setGenerationMetadata({
            lease,
            revision,
            metadataJson: '{"knowledgeFormat":"static-v1"}',
          });
          yield* store.applyBatch({
            lease,
            revision,
            batch: {
              files: [file("src/removed.ts"), file("src/current.ts")],
              entities: [
                entity("removed", "src/removed.ts"),
                entity("decodeRequest", "src/current.ts"),
              ],
            },
          });
          yield* store.applyBatch({
            lease,
            revision,
            batch: {},
            removeFilePaths: ["src/removed.ts"],
          });
          yield* store.publishGeneration({ lease, revision });
          return store.workspace.databasePath;
        }),
      );
      const database = new NodeSqlite.DatabaseSync(databasePath);
      database.exec("VACUUM");
      database.close();
      yield* Effect.scoped(
        Effect.gen(function* () {
          const reopened = yield* openKnowledgeStore({ workspaceRoot });
          const results = yield* reopened.searchRecords({
            revision: 1,
            query: "decodeRequest",
            kinds: ["entities"],
          });
          expect(results.items.map((hit) => hit.record.id)).toEqual(["decodeRequest"]);
        }),
      );
    }),
  );
});
