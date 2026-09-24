// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  openExistingKnowledgeStore,
  openKnowledgeStore,
  type KnowledgeBatch,
  type KnowledgePage,
} from "../persistence/KnowledgeStore.ts";
import { publishSyntheticIndexFixture } from "./SyntheticIndexFixture.ts";

const FILE_COUNT = 517;
const filePath = (index: number) => `src/unit-${String(index).padStart(3, "0")}.ts`;
const entityId = (index: number) => `entity:${index}`;
const sourceRange = {
  startLine: 1,
  startColumn: 1,
  endLine: 1,
  endColumn: 2,
  startOffset: 0,
  endOffset: 1,
};

function cyclicDependencyBatch(): KnowledgeBatch {
  return {
    files: Array.from({ length: FILE_COUNT }, (_, index) => ({
      path: filePath(index),
      language: "typescript",
      contentHash: `hash:${index}`,
      bytes: 1,
      classification: "source",
      status: "indexed",
      configDependencies: [],
    })),
    entities: Array.from({ length: FILE_COUNT }, (_, index) => ({
      id: entityId(index),
      filePath: filePath(index),
      kind: "function",
      name: `unit${index}`,
      qualifiedName: `unit${index}`,
      language: "typescript",
      range: sourceRange,
      sourceHash: `hash:${index}`,
      provenance: "compiler",
      freshness: "current",
      evidenceIds: [],
    })),
    callsites: Array.from({ length: FILE_COUNT }, (_, index) => ({
      id: `call:${index}`,
      filePath: filePath(index),
      callerEntityId: entityId(index),
      targetEntityIds: [entityId((index + FILE_COUNT - 1) % FILE_COUNT)],
      range: sourceRange,
      expression: `unit${(index + FILE_COUNT - 1) % FILE_COUNT}()`,
      dispatch: "direct",
      resolution: "resolved",
      sourceHash: `hash:${index}`,
      provenance: "compiler",
      freshness: "current",
      evidenceIds: [],
    })),
  };
}

it.live("pages every dependent beyond 200 nodes through a cycle using a read-only store", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-bounded-planning-")),
    );
    try {
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          yield* publishSyntheticIndexFixture(store, cyclicDependencyBatch(), "dependency-cycle");
          const reader = yield* openExistingKnowledgeStore({ workspaceRoot: root });
          if (!reader) throw new Error("Published fixture was not readable.");
          const before = yield* Effect.promise(() =>
            NodeFSP.readFile(store.workspace.databasePath),
          );
          const collected: string[] = [];
          let afterPath: string | undefined;
          do {
            const page = yield* reader.getAffectedFilePaths({
              revision: 1,
              changedPaths: [filePath(0)],
              limit: 37,
              ...(afterPath ? { afterPath } : {}),
            });
            expect(page.items.length).toBeLessThanOrEqual(37);
            collected.push(...page.items);
            expect(collected.length).toBeLessThanOrEqual(FILE_COUNT);
            afterPath = page.nextCursor ?? undefined;
          } while (afterPath !== undefined);
          expect(collected).toEqual(
            Array.from({ length: FILE_COUNT }, (_, index) => filePath(index)),
          );
          expect(new Set(collected).size).toBe(FILE_COUNT);
          const coverage = yield* reader.aggregateCoverage(1);
          expect(coverage.indexedFiles).toBe(FILE_COUNT);
          expect(coverage.totalEntities).toBe(FILE_COUNT);
          expect(coverage.resolvedCallsites).toBe(FILE_COUNT);
          expect(
            yield* Effect.promise(() => NodeFSP.readFile(store.workspace.databasePath)),
          ).toEqual(before);
        }),
      );
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  }),
);

it.live(
  "includes new configuration and removed files across revisions without losing later pages",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-planning-revisions-")),
      );
      try {
        yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* openKnowledgeStore({ workspaceRoot: root });
            yield* publishSyntheticIndexFixture(store, cyclicDependencyBatch(), "previous");
            const lease = yield* store.acquireLease("next");
            yield* store.beginGeneration({ lease, expectedRevision: 1, idempotencyKey: "next" });
            yield* store.applyBatch({
              lease,
              revision: 2,
              removeFilePaths: [filePath(10)],
              batch: {
                files: [
                  {
                    path: "tsconfig.json",
                    language: "json",
                    contentHash: "new-config",
                    bytes: 2,
                    classification: "configuration",
                    status: "pending",
                    configDependencies: [],
                  },
                ],
              },
            });
            const changes: string[] = [];
            let cursor: string | undefined;
            do {
              const page = yield* store.getChangedFilePaths({
                revision: 1,
                currentRevision: 2,
                limit: 1,
                ...(cursor ? { afterPath: cursor } : {}),
              });
              changes.push(...page.items);
              cursor = page.nextCursor ?? undefined;
            } while (cursor !== undefined);
            expect(changes).toEqual([filePath(10), "tsconfig.json"]);
            const affected: string[] = [];
            cursor = undefined;
            do {
              const page: KnowledgePage<string> = yield* store.getAffectedFilePaths({
                revision: 1,
                currentRevision: 2,
                changedPaths: ["tsconfig.json"],
                limit: 53,
                ...(cursor ? { afterPath: cursor } : {}),
              });
              expect(page.items.length).toBeLessThanOrEqual(53);
              affected.push(...page.items);
              expect(affected.length).toBeLessThanOrEqual(FILE_COUNT + 1);
              cursor = page.nextCursor ?? undefined;
            } while (cursor !== undefined);
            expect(affected).toEqual([
              ...Array.from({ length: FILE_COUNT }, (_, index) => filePath(index)),
              "tsconfig.json",
            ]);
            yield* store.releaseLease(lease);
            yield* store.clear();
            const removed = yield* store
              .getAffectedFilePaths({ revision: 1, changedPaths: [filePath(0)], limit: 37 })
              .pipe(Effect.flip);
            expect(removed.code).toBe("revision-conflict");
          }),
        );
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
