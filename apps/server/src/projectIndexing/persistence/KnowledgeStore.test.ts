// @effect-diagnostics nodeBuiltinImport:off
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { it } from "@effect/vitest";
import type { ProjectEntityV1, ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { afterEach, describe, expect } from "vite-plus/test";

import { hashProjectSourceFile, prepareKnowledgeWorkspace } from "../privacy/WorkspacePrivacy.ts";
import {
  openExistingKnowledgeStore,
  openKnowledgeStore,
  type KnowledgeStore,
} from "./KnowledgeStore.ts";
import { KNOWLEDGE_STORE_APPLICATION_ID } from "./KnowledgeStoreSchema.ts";
import { writeKnowledgeManifest } from "./KnowledgeViews.ts";

const directories: string[] = [];
function directory() {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-store-"));
  directories.push(root);
  return root;
}
afterEach(() => {
  for (const root of directories.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

function withStore<A, E, R>(run: (store: KnowledgeStore, root: string) => Effect.Effect<A, E, R>) {
  const root = directory();
  return Effect.scoped(
    Effect.gen(function* () {
      const store = yield* openKnowledgeStore({ workspaceRoot: root });
      return yield* run(store, root);
    }),
  );
}

const source = (filePath = "source.ts", contentHash = "source-hash"): ProjectSourceFileV1 => ({
  path: filePath,
  contentHash,
  language: "typescript",
  bytes: 12,
  classification: "source",
  status: "indexed",
  configDependencies: [],
});
const entity = (
  id: string,
  filePath = "source.ts",
  sourceHash = "source-hash",
): ProjectEntityV1 => ({
  id,
  filePath,
  sourceHash,
  kind: "function",
  name: id,
  qualifiedName: id,
  language: "typescript",
  range: { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 },
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});

describe("durable project knowledge", () => {
  it.effect(
    "resumes static publication without recreating symbol views or deleting user files",
    () =>
      withStore((store) =>
        Effect.gen(function* () {
          const lease = yield* store.acquireLease("writer");
          yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "static" });
          yield* store.setGenerationMetadata({
            lease,
            revision: 1,
            metadataJson: '{"knowledgeFormat":"static-v1"}',
          });
          const symbols = Array.from({ length: 64 }, (_, index) => entity(`symbol-${index}`));
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: { files: [source()], entities: symbols },
          });
          const oldGeneration = NodePath.join(
            store.workspace.knowledgeRoot,
            "generations",
            `1-${lease.token}`,
          );
          const oldSymbol = NodePath.join(oldGeneration, "symbols", `${"a".repeat(64)}.md`);
          const unknownFile = NodePath.join(oldGeneration, "handwritten.txt");
          NodeFS.mkdirSync(NodePath.dirname(oldSymbol), { recursive: true });
          NodeFS.writeFileSync(oldSymbol, "old generated symbol");
          NodeFS.writeFileSync(unknownFile, "keep me");
          const database = new NodeSqlite.DatabaseSync(store.workspace.databasePath);
          database
            .prepare(
              "INSERT INTO knowledge_artifacts(path, content_hash, revision) VALUES (?, ?, 1)",
            )
            .run(
              `generations/1-${lease.token}/symbols/${"a".repeat(64)}.md`,
              NodeCrypto.createHash("sha256").update("old generated symbol").digest("hex"),
            );
          database.close();
          yield* store.pauseGeneration(1);
          const resumed = yield* store.acquireLease("resumed");
          yield* store.resumeGeneration({ lease: resumed, revision: 1 });
          yield* store.publishGeneration({ lease: resumed, revision: 1 });

          const generation = NodePath.join(
            store.workspace.knowledgeRoot,
            "generations",
            `1-${resumed.token}`,
          );
          expect(NodeFS.readdirSync(generation)).toEqual(["INDEX.md"]);
          expect(NodeFS.existsSync(oldSymbol)).toBe(false);
          expect(NodeFS.readFileSync(unknownFile, "utf8")).toBe("keep me");
          expect(NodeFS.readFileSync(NodePath.join(generation, "INDEX.md"), "utf8")).toContain(
            "entities: 64",
          );
          expect((yield* store.getState()).publishedRevision).toBe(1);
          expect((yield* store.listRecords({ kind: "entities", revision: 1 })).items).toHaveLength(
            symbols.length,
          );
        }),
      ),
  );

  it.effect("rejects a late retry result under the same workspace lease", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.enqueueJobs({
          lease,
          revision: 1,
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
        const first = (yield* store.claimJobs({ lease, revision: 1 }))[0]!;
        yield* store.failJob({
          lease,
          revision: 1,
          jobId: first.id,
          claimToken: first.claimToken,
          retryable: true,
          detail: "Worker response timed out",
        });
        const retry = (yield* store.claimJobs({ lease, revision: 1 }))[0]!;
        expect(retry.claimToken).not.toBe(first.claimToken);
        expect(
          (yield* Effect.flip(
            store.completeJob({
              lease,
              revision: 1,
              jobId: first.id,
              claimToken: first.claimToken,
              batch: { entities: [entity("obsolete")] },
            }),
          )).code,
        ).toBe("job-conflict");
        yield* store.completeJob({
          lease,
          revision: 1,
          jobId: retry.id,
          claimToken: retry.claimToken,
          batch: { entities: [entity("current")] },
        });
        expect(
          (yield* store.listRecords({ kind: "entities", revision: 1 })).items.map(
            (item) => item.id,
          ),
        ).toEqual(["current"]);
      }),
    ),
  );

  it.effect("recovers interrupted first initialization only with a valid ownership marker", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = directory();
        const workspace = yield* prepareKnowledgeWorkspace(root);
        yield* writeKnowledgeManifest(workspace, {
          owner: "t3-project-index",
          schemaVersion: 1,
          workspaceId: workspace.workspaceId,
          publishedRevision: null,
          generationPath: null,
        });
        NodeFS.writeFileSync(workspace.databasePath, "");
        const store = yield* openKnowledgeStore({ workspaceRoot: root });
        expect((yield* store.getState()).revision).toBe(0);
        const otherRoot = directory();
        const other = yield* prepareKnowledgeWorkspace(otherRoot);
        NodeFS.writeFileSync(other.databasePath, "");
        expect((yield* Effect.flip(openKnowledgeStore({ workspaceRoot: otherRoot }))).code).toBe(
          "unsupported-version",
        );
      }),
    ),
  );

  it.effect("protects older owned schemas without destructive migration", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = directory();
        const workspace = yield* prepareKnowledgeWorkspace(root);
        const database = new NodeSqlite.DatabaseSync(workspace.databasePath);
        database.exec(
          `PRAGMA application_id = ${KNOWLEDGE_STORE_APPLICATION_ID}; CREATE TABLE legacy(value TEXT); INSERT INTO legacy VALUES ('preserved')`,
        );
        database.close();
        expect((yield* Effect.flip(openKnowledgeStore({ workspaceRoot: root }))).code).toBe(
          "unsupported-version",
        );
        const existing = new NodeSqlite.DatabaseSync(workspace.databasePath, { readOnly: true });
        expect(existing.prepare("SELECT value FROM legacy").get()?.value).toBe("preserved");
        existing.close();
      }),
    ),
  );

  it.effect("retrieves top-level callers and source signatures with bounded queries", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "first" });
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: {
            files: [source()],
            entities: [{ ...entity("read"), signature: "read(filePath: string): Config" }],
            callsites: [
              {
                id: "top-level-call",
                filePath: "source.ts",
                sourceHash: "source-hash",
                range: entity("read").range,
                expression: "read(configPath)",
                dispatch: "direct",
                resolution: "resolved",
                targetEntityIds: ["read"],
                evidenceIds: [],
                provenance: "parser",
                freshness: "current",
              },
            ],
          },
        });
        expect(
          (yield* store.listCalls({
            entityIds: ["read"],
            direction: "callers",
            revision: 1,
          })).items.map((call) => call.id),
        ).toEqual(["top-level-call"]);
        expect(
          (yield* store.listRecords({
            kind: "entities",
            query: "filePath",
            revision: 1,
          })).items.map((item) => item.id),
        ).toEqual(["read"]);
      }),
    ),
  );

  it.effect("retains exclusion metadata without accepting secret source content", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: {
            files: [
              {
                ...source(".env.local", "unread"),
                bytes: 0,
                classification: "ignored",
                status: "skipped",
              },
              {
                ...source(".t3", "unread"),
                bytes: 0,
                classification: "ignored",
                status: "skipped",
              },
            ],
            gaps: [
              {
                id: "excluded-env",
                kind: "excluded",
                filePath: ".env.local",
                message: "Credentials excluded without reading",
                retryable: false,
              },
            ],
          },
        });
        expect((yield* store.listRecords({ kind: "files", revision: 1 })).items).toHaveLength(2);
        expect(
          (yield* Effect.flip(
            store.applyBatch({
              lease,
              revision: 1,
              batch: { entities: [entity("secret", ".env.local")] },
            }),
          )).code,
        ).toBe("private-source");
        expect(
          (yield* Effect.flip(
            store.enqueueJobs({
              lease,
              revision: 1,
              jobs: [
                {
                  id: "secret-job",
                  idempotencyKey: "secret-job",
                  kind: "extract",
                  filePath: ".env.local",
                  contentHash: "unread",
                  inputJson: "{}",
                },
              ],
            }),
          )).code,
        ).toBe("invalid-job");
      }),
    ),
  );

  it.effect("opens missing read-only stores without creating private directories", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const root = directory();
        expect(yield* openExistingKnowledgeStore({ workspaceRoot: root })).toBeNull();
        expect(NodeFS.existsSync(NodePath.join(root, ".t3"))).toBe(false);
      }),
    ),
  );

  it.effect("persists canonical records and publishes complete generated views", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "first",
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: { files: [source()], entities: [entity("first"), entity("second")] },
        });
        expect((yield* store.listRecords({ kind: "entities" })).items).toEqual([]);
        expect(
          (yield* store.listRecords({ kind: "entities", revision, limit: 1 })).nextCursor,
        ).toBe("first");
        yield* store.publishGeneration({ lease, revision });
        expect((yield* store.getState()).publishedRevision).toBe(1);
        const readOnly = yield* openExistingKnowledgeStore({
          workspaceRoot: store.workspace.workspaceRoot,
        });
        expect(readOnly).not.toBeNull();
        if (!readOnly) return;
        expect(
          (yield* readOnly.listRecords({ kind: "entities", limit: 1, afterId: "first" })).items.map(
            (item) => item.id,
          ),
        ).toEqual(["second"]);
        const manifest = NodeFS.readFileSync(
          NodePath.join(store.workspace.knowledgeRoot, "manifest.json"),
          "utf8",
        );
        expect(manifest).toContain('"publishedRevision": 1');
        expect(
          NodeFS.readFileSync(NodePath.join(store.workspace.knowledgeRoot, "INDEX.md"), "utf8"),
        ).toContain("Open revision 1");
        expect((yield* Effect.flip(readOnly.acquireLease("forbidden"))).code).toBe("read-only");
      }),
    ),
  );

  it.effect("uses one writer lease across independent handles and rejects late worker writes", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const second = yield* openKnowledgeStore({ workspaceRoot: store.workspace.workspaceRoot });
        const lease = yield* store.acquireLease("first", 1000);
        expect((yield* Effect.flip(second.acquireLease("second"))).code).toBe("lease-conflict");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "first",
        });
        yield* TestClock.adjust("2 seconds");
        const newLease = yield* second.acquireLease("second");
        yield* second.beginGeneration({
          lease: newLease,
          expectedRevision: revision,
          idempotencyKey: "second",
        });
        expect(
          (yield* Effect.flip(store.applyBatch({ lease, revision, batch: { files: [source()] } })))
            .code,
        ).toBe("lease-conflict");
        expect(
          (yield* Effect.flip(
            second.applyBatch({ lease: newLease, revision, batch: { files: [source()] } }),
          )).code,
        ).toBe("revision-conflict");
        expect((yield* second.listRecords({ kind: "files", revision: 2 })).items).toEqual([]);
      }),
    ),
  );

  it.effect("rolls back a batch when one record has stale source evidence", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        const failure = yield* Effect.flip(
          store.applyBatch({
            lease,
            revision: 1,
            batch: {
              files: [source()],
              entities: [entity("fresh"), entity("outdated", "source.ts", "older-hash")],
            },
          }),
        );
        expect(failure.code).toBe("stale-source");
        expect((yield* store.listRecords({ kind: "files", revision: 1 })).items).toEqual([]);
        expect((yield* store.listRecords({ kind: "entities", revision: 1 })).items).toEqual([]);
      }),
    ),
  );

  it.effect("never grants a fourth attempt through pause and resume", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.enqueueJobs({
          lease,
          revision: 1,
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
        for (let attempt = 1; attempt <= 3; attempt++) {
          const job = (yield* store.claimJobs({ lease, revision: 1 }))[0]!;
          expect(job.attempts).toBe(attempt);
          if (attempt < 3)
            yield* store.failJob({
              lease,
              revision: 1,
              jobId: "unit",
              retryable: true,
              claimToken: job.claimToken,
              detail: "temporary",
            });
        }
        yield* store.pauseGeneration(1);
        const resumed = yield* store.acquireLease("resumed");
        yield* store.resumeGeneration({ lease: resumed, revision: 1 });
        expect(yield* store.claimJobs({ lease: resumed, revision: 1 })).toEqual([]);
        expect((yield* store.listJobs({ revision: 1 })).items[0]?.state).toBe("failed");
      }),
    ),
  );

  it.effect("makes generation requests and job submission idempotent", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        const first = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "same",
        });
        const repeated = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "same",
        });
        expect(repeated.revision).toBe(first.revision);
        const input = {
          lease,
          revision: first.revision,
          jobs: [
            {
              id: "one",
              idempotencyKey: "same-unit",
              kind: "resolve" as const,
              filePath: "",
              contentHash: "",
              inputJson: "{}",
            },
          ],
        };
        yield* store.enqueueJobs(input);
        yield* store.enqueueJobs(input);
        const claimed = yield* store.claimJobs({ lease, revision: first.revision });
        expect(claimed).toHaveLength(1);
        yield* store.completeJob({
          lease,
          revision: first.revision,
          jobId: "one",
          claimToken: claimed[0]!.claimToken,
        });
        yield* store.completeJob({
          lease,
          revision: first.revision,
          jobId: "one",
          claimToken: claimed[0]!.claimToken,
        });
        expect(yield* store.getJobsSummary(first.revision)).toEqual([
          { kind: "resolve", state: "completed", count: 1, attempts: 1 },
        ]);
      }),
    ),
  );

  it.effect("recovers interrupted units after closing and reopening the database", () => {
    const root = directory();
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          const lease = yield* store.acquireLease("crashed", 100);
          yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "recover" });
          yield* store.enqueueJobs({
            lease,
            revision: 1,
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
          yield* store.claimJobs({ lease, revision: 1 });
          yield* store.applyBatch({ lease, revision: 1, batch: { files: [source()] } });
        }),
      );
      yield* TestClock.adjust("1 second");
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          const lease = yield* store.acquireLease("recovered");
          yield* store.recoverJobs({ lease, revision: 1 });
          expect((yield* store.listJobs({ revision: 1 })).items[0]?.state).toBe("pending");
          expect((yield* store.listRecords({ kind: "files", revision: 1 })).items[0]?.path).toBe(
            "source.ts",
          );
        }),
      );
    });
  });

  it.effect("rejects semantic completion when uncommitted source bytes changed", () =>
    withStore((store, root) =>
      Effect.gen(function* () {
        NodeFS.writeFileSync(NodePath.join(root, "source.ts"), "first source");
        const hash = yield* hashProjectSourceFile(root, "source.ts");
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: { files: [source("source.ts", hash)] },
        });
        yield* store.enqueueJobs({
          lease,
          revision: 1,
          jobs: [
            {
              id: "unit",
              idempotencyKey: "unit",
              kind: "semantic",
              filePath: "source.ts",
              contentHash: hash,
              inputJson: "{}",
            },
          ],
        });
        const claimed = yield* store.claimJobs({ lease, revision: 1 });
        NodeFS.writeFileSync(NodePath.join(root, "source.ts"), "uncommitted changed source");
        expect(
          (yield* Effect.flip(
            store.completeJob({
              lease,
              revision: 1,
              jobId: "unit",
              batch: { entities: [entity("late", "source.ts", hash)] },
              claimToken: claimed[0]!.claimToken,
            }),
          )).code,
        ).toBe("stale-source");
        expect((yield* store.listRecords({ kind: "entities", revision: 1 })).items).toEqual([]);
      }),
    ),
  );

  it.effect("revokes paused and cancelled workers and resumes durable progress", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.applyBatch({ lease, revision: 1, batch: { files: [source()] } });
        yield* store.pauseGeneration(1);
        expect((yield* Effect.flip(store.applyBatch({ lease, revision: 1, batch: {} }))).code).toBe(
          "lease-conflict",
        );
        const resumed = yield* store.acquireLease("resumed");
        yield* store.resumeGeneration({ lease: resumed, revision: 1 });
        expect((yield* store.listRecords({ kind: "files", revision: 1 })).items).toHaveLength(1);
        yield* store.cancelGeneration(1);
        expect(
          (yield* Effect.flip(store.publishGeneration({ lease: resumed, revision: 1 }))).code,
        ).toBe("lease-conflict");
        expect((yield* store.getState()).publishedRevision).toBeNull();
      }),
    ),
  );

  it.effect("filters bounded relationships and invalidates dependent semantic records", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: {
            files: [source("src/one.ts"), source("other/two.ts")],
            entities: [entity("caller", "src/one.ts"), entity("callee", "other/two.ts")],
            callsites: [
              {
                id: "call",
                callerEntityId: "caller",
                filePath: "src/one.ts",
                range: entity("x").range,
                expression: "callee()",
                dispatch: "direct",
                resolution: "resolved",
                targetEntityIds: ["callee"],
                sourceHash: "source-hash",
                provenance: "parser",
                freshness: "current",
                evidenceIds: [],
              },
            ],
            behaviors: [
              {
                id: "behavior",
                entityIds: ["callee"],
                summary: "Handles the request",
                inputs: [],
                outputs: [],
                sideEffects: [],
                errorPaths: [],
                invariants: [],
                provenance: "parser",
                freshness: "current",
                evidenceIds: [],
              },
            ],
          },
        });
        expect(
          (yield* store.listCalls({
            entityIds: ["callee"],
            direction: "callers",
            revision: 1,
          })).items.map((call) => call.id),
        ).toEqual(["call"]);
        const dependencies = yield* store.getRecordDependencyPaths({
          kind: "callsites",
          id: "call",
          revision: 1,
          limit: 1,
        });
        expect(dependencies.items).toEqual(["other/two.ts"]);
        expect(dependencies.nextCursor).toBe("other/two.ts");
        expect(
          (yield* store.getRecordDependencyPaths({
            kind: "callsites",
            id: "call",
            revision: 1,
            afterPath: dependencies.nextCursor!,
            limit: 1,
          })).items,
        ).toEqual(["src/one.ts"]);
        expect(
          (yield* store.listRecords({
            kind: "entities",
            revision: 1,
            filePathPrefixes: ["src"],
          })).items.map((item) => item.id),
        ).toEqual(["caller"]);
        expect(
          (yield* store.listRecords({ kind: "behaviors", revision: 1, entityIds: ["callee"] }))
            .items,
        ).toHaveLength(1);
        yield* store.publishGeneration({ lease, revision: 1 });
        yield* store.beginGeneration({ lease, expectedRevision: 1, idempotencyKey: "two" });
        yield* store.invalidateFiles({ lease, revision: 2, filePaths: ["other/two.ts"] });
        expect((yield* store.getRecord("behaviors", "behavior"))?.freshness).toBe("current");
        expect((yield* store.getRecord("callsites", "call"))?.freshness).toBe("current");
        expect((yield* store.getRecord("behaviors", "behavior", 2))?.freshness).toBe("stale");
        expect((yield* store.getRecord("callsites", "call", 2))?.freshness).toBe("stale");
        yield* store.applyBatch({
          lease,
          revision: 2,
          removeFilePaths: ["other/two.ts"],
          batch: {},
        });
        expect(yield* store.getRecord("behaviors", "behavior", 2)).toBeNull();
        expect(yield* store.getRecord("callsites", "call", 2)).toBeNull();
      }),
    ),
  );

  it.effect("clears owned knowledge while preserving MEMORY and unknown files", () =>
    withStore((store, root) =>
      Effect.gen(function* () {
        yield* store.setSettings({
          ...(yield* store.getSettings()),
          enabled: true,
          autoRefresh: true,
        });
        NodeFS.writeFileSync(NodePath.join(root, ".t3", "MEMORY.md"), "Keep this memory");
        NodeFS.writeFileSync(
          NodePath.join(store.workspace.knowledgeRoot, "handwritten.txt"),
          "Keep this too",
        );
        const lease = yield* store.acquireLease("worker");
        yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "one" });
        yield* store.applyBatch({ lease, revision: 1, batch: { entities: [entity("one")] } });
        yield* store.publishGeneration({ lease, revision: 1 });
        expect((yield* Effect.flip(store.clear())).code).toBe("lease-conflict");
        yield* store.releaseLease(lease);
        yield* store.clear();
        expect((yield* store.getSettings()).enabled).toBe(false);
        expect((yield* store.getSettings()).autoRefresh).toBe(true);
        expect((yield* store.getState()).publishedRevision).toBeNull();
        expect((yield* store.listRecords({ kind: "entities" })).items).toEqual([]);
        expect(NodeFS.readFileSync(NodePath.join(root, ".t3", "MEMORY.md"), "utf8")).toBe(
          "Keep this memory",
        );
        expect(
          NodeFS.readFileSync(
            NodePath.join(store.workspace.knowledgeRoot, "handwritten.txt"),
            "utf8",
          ),
        ).toBe("Keep this too");
      }),
    ),
  );

  it.effect("recovers a publication manifest after an interrupted database commit", () => {
    const root = directory();
    return Effect.gen(function* () {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          const lease = yield* store.acquireLease("writer");
          yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "first" });
          yield* store.publishGeneration({ lease, revision: 1 });
          yield* store.releaseLease(lease);
          // A process can exit after atomic filesystem publication but before SQLite commits.
          yield* store.writePublication({
            owner: "t3-project-index",
            schemaVersion: 1,
            workspaceId: store.workspace.workspaceId,
            publishedRevision: 2,
            generationPath: "generations/2-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          });
        }),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          expect((yield* store.getState()).publishedRevision).toBe(1);
          expect(
            NodeFS.readFileSync(
              NodePath.join(store.workspace.knowledgeRoot, "manifest.json"),
              "utf8",
            ),
          ).toContain('"publishedRevision": 1');
          expect(
            NodeFS.readFileSync(NodePath.join(store.workspace.knowledgeRoot, "INDEX.md"), "utf8"),
          ).toContain("Open revision 1");
        }),
      );
    });
  });

  it.effect("preserves an existing unowned INDEX and reports a read-only workspace", () => {
    const root = directory();
    NodeFS.mkdirSync(NodePath.join(root, ".t3", "knowledge"), { recursive: true });
    const filename = NodePath.join(root, ".t3", "knowledge", "INDEX.md");
    NodeFS.writeFileSync(filename, "A handwritten index");
    return Effect.scoped(
      Effect.gen(function* () {
        expect((yield* Effect.flip(openKnowledgeStore({ workspaceRoot: root }))).code).toBe(
          "unowned-store",
        );
        expect(NodeFS.readFileSync(filename, "utf8")).toBe("A handwritten index");
        if (process.getuid?.() === 0) return;
        const readonlyRoot = directory();
        NodeFS.mkdirSync(NodePath.join(readonlyRoot, ".t3"), { mode: 0o500 });
        yield* Effect.gen(function* () {
          const failure = yield* Effect.flip(openKnowledgeStore({ workspaceRoot: readonlyRoot }));
          expect(failure.detail).toContain("permissions");
          expect(NodeFS.existsSync(NodePath.join(readonlyRoot, ".t3", "knowledge.sqlite"))).toBe(
            false,
          );
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => NodeFS.chmodSync(NodePath.join(readonlyRoot, ".t3"), 0o700)),
          ),
        );
      }),
    );
  });

  it.effect(
    "preserves unsupported and corrupt stores instead of migrating or replacing them",
    () => {
      const root = directory();
      const knowledgeRoot = NodePath.join(root, ".t3", "knowledge");
      NodeFS.mkdirSync(knowledgeRoot, { recursive: true });
      const databasePath = NodePath.join(knowledgeRoot, "knowledge.sqlite");
      const database = new NodeSqlite.DatabaseSync(databasePath);
      database.exec(
        `PRAGMA application_id = ${KNOWLEDGE_STORE_APPLICATION_ID}; PRAGMA user_version = 999; CREATE TABLE preserve(value TEXT); INSERT INTO preserve VALUES ('safe')`,
      );
      database.close();
      return Effect.scoped(
        Effect.gen(function* () {
          expect((yield* Effect.flip(openKnowledgeStore({ workspaceRoot: root }))).code).toBe(
            "unsupported-version",
          );
          const existing = new NodeSqlite.DatabaseSync(databasePath, { readOnly: true });
          expect(existing.prepare("SELECT value FROM preserve").get()?.value).toBe("safe");
          existing.close();
          const corruptRoot = directory();
          NodeFS.mkdirSync(NodePath.join(corruptRoot, ".t3", "knowledge"), { recursive: true });
          NodeFS.writeFileSync(
            NodePath.join(corruptRoot, ".t3", "knowledge", "knowledge.sqlite"),
            "invalid sqlite",
          );
          const failed = yield* Effect.flip(openKnowledgeStore({ workspaceRoot: corruptRoot }));
          expect(failed.code).toBe("storage-failed");
          expect(
            NodeFS.readFileSync(
              NodePath.join(corruptRoot, ".t3", "knowledge", "knowledge.sqlite"),
              "utf8",
            ),
          ).toBe("invalid sqlite");
        }),
      );
    },
  );
});
