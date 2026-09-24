// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import type { ProjectCallsiteV1, ProjectEntityV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";

import { openKnowledgeStore, type KnowledgeStore, type WriterLease } from "./KnowledgeStore.ts";

const roots: string[] = [];
const range = (startOffset: number, endOffset: number) => ({
  startLine: 1,
  startColumn: startOffset + 1,
  endLine: 1,
  endColumn: endOffset + 1,
  startOffset,
  endOffset,
});
const entity = (
  id: string,
  start: number,
  end: number,
  kind: ProjectEntityV1["kind"] = "function",
): ProjectEntityV1 => ({
  id,
  filePath: "file.ts",
  name: id,
  qualifiedName: id,
  kind,
  language: "typescript",
  range: range(start, end),
  sourceHash: "hash",
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});
const callsite = (id: string, start: number, end: number): ProjectCallsiteV1 => ({
  id,
  filePath: "file.ts",
  callerEntityId: "caller",
  expression: "target()",
  range: range(start, end),
  dispatch: "direct",
  resolution: "resolved",
  targetEntityIds: ["target"],
  sourceHash: "hash",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
});

function withStore<A, E, R>(
  run: (store: KnowledgeStore, lease: WriterLease) => Effect.Effect<A, E, R>,
) {
  const root = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-knowledge-compiler-"));
  roots.push(root);
  return Effect.scoped(
    Effect.gen(function* () {
      const store = yield* openKnowledgeStore({ workspaceRoot: root });
      const lease = yield* store.acquireLease("worker");
      yield* store.beginGeneration({ lease, expectedRevision: 0, idempotencyKey: "first" });
      return yield* run(store, lease);
    }),
  );
}
afterEach(() => {
  for (const root of roots.splice(0)) NodeFS.rmSync(root, { recursive: true, force: true });
});

describe("bounded compiler lookups", () => {
  it.effect(
    "matches exact definition names and redirects variable declarations to direct executable children",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              entities: [
                { ...entity("Root", 0, 1000, "class"), nameRange: range(6, 10) },
                { ...entity("callback", 20, 80, "variable"), nameRange: range(26, 34) },
                { ...entity("callback-lambda", 35, 79, "lambda"), containerId: "callback" },
                { ...entity("nested", 45, 60), containerId: "callback-lambda" },
                entity("offset-method", 101, 131, "method"),
                entity("interface-only", 200, 300, "interface"),
              ],
            },
          });
          expect(
            (yield* store.getDeclarationTarget({
              revision: 1,
              filePath: "file.ts",
              startOffset: 6,
              endOffset: 10,
              name: "Root",
            }))?.id,
          ).toBe("Root");
          expect(
            (yield* store.getDeclarationTarget({
              revision: 1,
              filePath: "file.ts",
              startOffset: 26,
              endOffset: 34,
              name: "callback",
            }))?.id,
          ).toBe("callback-lambda");
          expect(
            (yield* store.getDeclarationTarget({
              revision: 1,
              filePath: "file.ts",
              startOffset: 20,
              endOffset: 80,
            }))?.id,
          ).toBe("callback-lambda");
          expect(
            (yield* store.getDeclarationTarget({
              revision: 1,
              filePath: "file.ts",
              startOffset: 100,
              endOffset: 130,
            }))?.id,
          ).toBe("offset-method");
          expect(
            yield* store.getDeclarationTarget({
              revision: 1,
              filePath: "file.ts",
              startOffset: 200,
              endOffset: 300,
            }),
          ).toBeNull();
          expect(
            yield* store.getDeclarationTarget({
              revision: 1,
              filePath: "file.ts",
              startOffset: 25,
              endOffset: 34,
              name: "callback",
            }),
          ).toBeNull();
        }),
      ),
  );

  it.effect(
    "returns exact callsite ranges once and rejects input or output overflow explicitly",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: { callsites: [callsite("one", 10, 14), callsite("two", 15, 20)] },
          });
          expect(
            (yield* store.getCallsitesAt({
              revision: 1,
              locations: [
                { filePath: "file.ts", startOffset: 10, endOffset: 14 },
                { filePath: "file.ts", startOffset: 10, endOffset: 14 },
                { filePath: "file.ts", startOffset: 15, endOffset: 20 },
              ],
            })).map((call) => call.id),
          ).toEqual(["one", "two"]);
          expect(
            (yield* Effect.flip(
              store.getCallsitesAt({
                revision: 1,
                locations: Array.from({ length: 129 }, () => ({
                  filePath: "file.ts",
                  startOffset: 10,
                  endOffset: 14,
                })),
              }),
            )).code,
          ).toBe("query-limit");
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              callsites: Array.from({ length: 601 }, (_, index) =>
                callsite(`crowded-${index}`, 30, 40),
              ),
            },
          });
          expect(
            (yield* Effect.flip(
              store.getCallsitesAt({
                revision: 1,
                locations: [{ filePath: "file.ts", startOffset: 30, endOffset: 40 }],
              }),
            )).code,
          ).toBe("query-limit");
        }),
      ),
  );

  it.effect("finds incoming calls when target entities arrive after their callsites", () =>
    withStore((store, lease) =>
      Effect.gen(function* () {
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: {
            entities: [entity("caller", 0, 100)],
            callsites: [callsite("incoming", 10, 14)],
          },
        });
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: { entities: [{ ...entity("target", 0, 100, "method"), filePath: "target.ts" }] },
        });
        yield* store.applyBatch({
          lease,
          revision: 1,
          batch: {
            callsites: [
              {
                ...callsite("outgoing", 30, 34),
                filePath: "target.ts",
                callerEntityId: "target",
                targetEntityIds: ["caller"],
              },
            ],
          },
        });
        expect(
          (yield* store.listRecords({
            kind: "callsites",
            revision: 1,
            filePath: "target.ts",
            limit: 1,
          })).items.map((call) => call.id),
        ).toEqual(["incoming"]);
        expect(
          (yield* store.listRecords({
            kind: "callsites",
            revision: 1,
            sourceFilePath: "target.ts",
            limit: 1,
          })).items.map((call) => call.id),
        ).toEqual(["outgoing"]);
        expect(
          (yield* store.listRecords({
            kind: "callsites",
            revision: 1,
            sourceFilePath: "file.ts",
            limit: 1,
          })).items.map((call) => call.id),
        ).toEqual(["incoming"]);
      }),
    ),
  );

  it.effect(
    "removes only the matching generated unresolved gap after compiler resolution improves",
    () =>
      withStore((store, lease) =>
        Effect.gen(function* () {
          yield* store.applyBatch({
            lease,
            revision: 1,
            batch: {
              callsites: [
                { ...callsite("resolved", 10, 14), resolution: "unresolved", targetEntityIds: [] },
                {
                  ...callsite("parse-error", 15, 20),
                  resolution: "unresolved",
                  targetEntityIds: [],
                },
              ],
              gaps: [
                {
                  id: "gap:resolved",
                  kind: "unresolved-call",
                  filePath: "file.ts",
                  message: "No target found",
                  retryable: true,
                },
                {
                  id: "gap:unrelated",
                  kind: "unresolved-call",
                  filePath: "file.ts",
                  message: "Another target missing",
                  retryable: true,
                },
                {
                  id: "gap:parse-error",
                  kind: "parse-error",
                  filePath: "file.ts",
                  message: "Parse diagnostic",
                  retryable: true,
                },
              ],
            },
          });
          yield* store.publishGeneration({ lease, revision: 1 });
          yield* store.beginGeneration({ lease, expectedRevision: 1, idempotencyKey: "second" });
          yield* store.applyBatch({
            lease,
            revision: 2,
            batch: { callsites: [callsite("resolved", 10, 14), callsite("parse-error", 15, 20)] },
          });
          expect(yield* store.getRecord("gaps", "gap:resolved", 2)).toBeNull();
          expect(yield* store.getRecord("gaps", "gap:resolved", 1)).not.toBeNull();
          expect(
            (yield* store.listRecords({ kind: "gaps", revision: 2 })).items.map((gap) => gap.id),
          ).toEqual(["gap:parse-error", "gap:unrelated"]);
          expect(
            (yield* store.getRecordDependencyPaths({
              kind: "gaps",
              id: "gap:resolved",
              revision: 2,
            })).items,
          ).toEqual([]);
        }),
      ),
  );

  it.effect("claims synthesis separately while retaining bounded multi-kind job pages", () =>
    withStore((store, lease) =>
      Effect.gen(function* () {
        yield* store.enqueueJobs({
          lease,
          revision: 1,
          jobs: [
            {
              id: "extract",
              idempotencyKey: "extract",
              kind: "extract",
              filePath: "file.ts",
              contentHash: "hash",
              inputJson: "{}",
            },
            {
              id: "synthesis",
              idempotencyKey: "synthesis",
              kind: "synthesis",
              filePath: "",
              contentHash: "",
              inputJson: "{}",
            },
            {
              id: "semantic",
              idempotencyKey: "semantic",
              kind: "semantic",
              filePath: "file.ts",
              contentHash: "hash",
              inputJson: "{}",
            },
          ],
        });
        expect(
          (yield* store.listJobs({ revision: 1, kinds: ["semantic", "synthesis"], limit: 1 }))
            .nextCursor,
        ).toBe("semantic");
        const claimed = yield* store.claimJobs({ lease, revision: 1, kinds: ["synthesis"] });
        expect(claimed.map((job) => job.id)).toEqual(["synthesis"]);
        yield* store.completeJob({
          lease,
          revision: 1,
          jobId: claimed[0]!.id,
          claimToken: claimed[0]!.claimToken,
        });
        expect(
          (yield* store.getJobsSummary(1)).find((summary) => summary.kind === "synthesis")?.state,
        ).toBe("completed");
      }),
    ),
  );
});
