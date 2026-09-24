// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it } from "@effect/vitest";
import type { ProjectEntityV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, describe, expect } from "vite-plus/test";

import { openKnowledgeStore, type KnowledgeStore, type WriterLease } from "./KnowledgeStore.ts";

const roots: string[] = [];
const metadataJson =
  '{"usage":{"usageStatus":"complete","inputTokens":47,"outputTokens":11,"requests":1}}';
const symbols: ReadonlyArray<ProjectEntityV1> = Array.from({ length: 20 }, (_, index) => ({
  id: `function-${index.toString().padStart(2, "0")}`,
  filePath: "source.ts",
  sourceHash: "source-hash",
  kind: "function",
  name: `function${index}`,
  qualifiedName: `function${index}`,
  language: "typescript",
  range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
}));

function directory() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-retention-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

const publish = Effect.fn("publishRetentionFixture")(function* (
  store: KnowledgeStore,
  lease: WriterLease,
  revision: number,
) {
  yield* store.beginGeneration({
    lease,
    expectedRevision: revision - 1,
    idempotencyKey: `generation-${revision}`,
  });
  yield* store.applyBatch({ lease, revision, batch: { entities: symbols } });
  yield* store.setGenerationMetadata({ lease, revision, metadataJson });
  yield* store.enqueueJobs({
    lease,
    revision,
    jobs: [
      {
        id: "unit",
        idempotencyKey: "unit",
        kind: "resolve",
        filePath: "",
        contentHash: "",
        inputJson: "{}",
      },
    ],
  });
  const job = (yield* store.claimJobs({ lease, revision }))[0]!;
  yield* store.completeJob({ lease, revision, jobId: job.id, claimToken: job.claimToken });
  yield* store.publishGeneration({ lease, revision });
});

function revisions(databasePath: string, table: string) {
  const db = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
  try {
    return db
      .prepare(`SELECT DISTINCT revision FROM ${table} ORDER BY revision`)
      .all()
      .map((row) => row.revision);
  } finally {
    db.close();
  }
}

function reserveArtifact(
  databasePath: string,
  knowledgeRoot: string,
  revision: number,
  relativePath: string,
  content: string,
  writeFile = true,
) {
  const db = new NodeSqlite.DatabaseSync(databasePath);
  try {
    db.prepare(
      "INSERT INTO knowledge_artifacts(path, content_hash, revision) VALUES (?, ?, ?)",
    ).run(relativePath, NodeCrypto.createHash("sha256").update(content).digest("hex"), revision);
  } finally {
    db.close();
  }
  if (writeFile) {
    const filename = NodePath.join(knowledgeRoot, relativePath);
    NodeFS.mkdirSync(NodePath.dirname(filename), { recursive: true });
    NodeFS.writeFileSync(filename, content);
  }
}

describe("knowledge retention", () => {
  it.effect(
    "bounds many automatic refreshes to three published generations while retaining measured usage",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const root = directory();
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          const lease = yield* store.acquireLease("worker");
          for (let revision = 1; revision <= 10; revision++) {
            yield* publish(store, lease, revision);
            const retained = Array.from(
              { length: Math.min(3, revision) },
              (_, index) => revision - Math.min(3, revision) + index + 1,
            );
            for (const table of [
              "knowledge_records",
              "knowledge_record_dependencies",
              "knowledge_jobs",
              "knowledge_artifacts",
            ])
              expect(revisions(store.workspace.databasePath, table)).toEqual(retained);
            expect(
              NodeFS.readdirSync(NodePath.join(store.workspace.knowledgeRoot, "generations")),
            ).toHaveLength(retained.length);
          }
          expect((yield* store.listRecords({ kind: "entities", revision: 8 })).items).toHaveLength(
            20,
          );
          expect(
            (yield* Effect.flip(store.listRecords({ kind: "entities", revision: 7 }))).code,
          ).toBe("revision-conflict");
          expect((yield* Effect.flip(store.getJobsSummary(7))).code).toBe("revision-conflict");
          expect(yield* store.getGenerationMetadata(1)).toBe(metadataJson);
          expect((yield* store.getState()).publishedRevision).toBe(10);
        }),
      ),
  );

  it.effect(
    "keeps an in-flight SQLite reader's snapshot while later publications collect its generation",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: directory() });
          const lease = yield* store.acquireLease("worker");
          yield* publish(store, lease, 1);
          const reader = new NodeSqlite.DatabaseSync(store.workspace.databasePath, {
            readOnly: true,
          });
          try {
            reader.exec("BEGIN");
            expect(
              reader
                .prepare("SELECT COUNT(*) AS count FROM knowledge_records WHERE revision = 1")
                .get()?.count,
            ).toBe(20);
            for (let revision = 2; revision <= 4; revision++)
              yield* publish(store, lease, revision);
            expect(
              reader
                .prepare("SELECT COUNT(*) AS count FROM knowledge_records WHERE revision = 1")
                .get()?.count,
            ).toBe(20);
            expect(
              (yield* Effect.flip(store.listRecords({ kind: "entities", revision: 1 }))).code,
            ).toBe("revision-conflict");
            expect(
              (yield* store.listRecords({ kind: "entities", revision: 2 })).items,
            ).toHaveLength(20);
            reader.exec("COMMIT");
          } finally {
            reader.close();
          }
        }),
      ),
  );

  it.effect("collects a cancelled revision between retained publications", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* openKnowledgeStore({ workspaceRoot: directory() });
        const lease = yield* store.acquireLease("worker");
        for (let revision = 1; revision <= 3; revision++) yield* publish(store, lease, revision);

        yield* store.beginGeneration({
          lease,
          expectedRevision: 3,
          idempotencyKey: "cancelled-4",
        });
        yield* store.applyBatch({ lease, revision: 4, batch: { entities: symbols } });
        yield* store.cancelGeneration(4);

        const nextLease = yield* store.acquireLease("next-worker");
        yield* publish(store, nextLease, 5);
        for (const table of [
          "knowledge_records",
          "knowledge_record_dependencies",
          "knowledge_jobs",
        ])
          expect(revisions(store.workspace.databasePath, table)).toEqual([2, 3, 5]);
      }),
    ),
  );

  it.effect(
    "recovers interrupted collection and publication without removing active progress or user files",
    () => {
      const root = directory();
      return Effect.gen(function* () {
        let knowledgeRoot = "";
        let databasePath = "";
        let activeArtifact = "";
        const obsoleteDirectory = "generations/1-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
        yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* openKnowledgeStore({ workspaceRoot: root });
            knowledgeRoot = store.workspace.knowledgeRoot;
            databasePath = store.workspace.databasePath;
            const lease = yield* store.acquireLease("interrupted", 1000);
            for (let revision = 1; revision <= 4; revision++)
              yield* publish(store, lease, revision);
            yield* store.beginGeneration({ lease, expectedRevision: 4, idempotencyKey: "active" });
            yield* store.applyBatch({ lease, revision: 5, batch: { entities: symbols } });

            // Reservations persist across a crash, including files not written yet.
            reserveArtifact(
              databasePath,
              knowledgeRoot,
              1,
              `${obsoleteDirectory}/INDEX.md`,
              "owned obsolete view",
            );
            reserveArtifact(
              databasePath,
              knowledgeRoot,
              1,
              `${obsoleteDirectory}/symbols/${"a".repeat(64)}.md`,
              "reserved but unwritten",
              false,
            );
            reserveArtifact(
              databasePath,
              knowledgeRoot,
              1,
              `${obsoleteDirectory}/symbols/${"b".repeat(64)}.md`,
              "original generated content",
            );
            NodeFS.writeFileSync(
              NodePath.join(knowledgeRoot, obsoleteDirectory, "symbols", `${"b".repeat(64)}.md`),
              "A user's edit",
            );
            NodeFS.writeFileSync(
              NodePath.join(knowledgeRoot, obsoleteDirectory, "notes.txt"),
              "A user's unrelated file",
            );
            activeArtifact = `generations/5-${lease.token}/INDEX.md`;
            reserveArtifact(
              databasePath,
              knowledgeRoot,
              5,
              activeArtifact,
              "partial active publication",
            );
            yield* store.writePublication({
              owner: "t3-project-index",
              schemaVersion: 1,
              workspaceId: store.workspace.workspaceId,
              publishedRevision: 5,
              generationPath: `generations/5-${lease.token}`,
            });
          }),
        );

        yield* TestClock.adjust("2 seconds");
        yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* openKnowledgeStore({ workspaceRoot: root });
            expect((yield* store.getState()).publishedRevision).toBe(4);
            expect(
              (yield* store.listRecords({ kind: "entities", revision: 5 })).items,
            ).toHaveLength(20);
            expect(revisions(databasePath, "knowledge_records")).toEqual([2, 3, 4, 5]);
            expect(revisions(databasePath, "knowledge_artifacts")).toEqual([2, 3, 4, 5]);
            expect(
              NodeFS.existsSync(NodePath.join(knowledgeRoot, obsoleteDirectory, "INDEX.md")),
            ).toBe(false);
            expect(
              NodeFS.readFileSync(
                NodePath.join(knowledgeRoot, obsoleteDirectory, "notes.txt"),
                "utf8",
              ),
            ).toBe("A user's unrelated file");
            expect(
              NodeFS.readFileSync(
                NodePath.join(knowledgeRoot, obsoleteDirectory, "symbols", `${"b".repeat(64)}.md`),
                "utf8",
              ),
            ).toBe("A user's edit");
            expect(NodeFS.readFileSync(NodePath.join(knowledgeRoot, activeArtifact), "utf8")).toBe(
              "partial active publication",
            );
            expect(NodeFS.readFileSync(NodePath.join(knowledgeRoot, "INDEX.md"), "utf8")).toContain(
              "Open revision 4",
            );
            const resumed = yield* store.acquireLease("resumed");
            yield* store.resumeGeneration({ lease: resumed, revision: 5 });
            yield* store.publishGeneration({ lease: resumed, revision: 5 });
            expect(NodeFS.existsSync(NodePath.join(knowledgeRoot, activeArtifact))).toBe(false);
            expect(revisions(databasePath, "knowledge_records")).toEqual([3, 4, 5]);
            expect(yield* store.getGenerationMetadata(1)).toBe(metadataJson);
          }),
        );
      });
    },
  );
});
