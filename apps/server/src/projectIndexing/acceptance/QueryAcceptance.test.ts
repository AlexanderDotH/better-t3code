// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { ProjectIndexQueryResultV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect, it } from "@effect/vitest";
import {
  compareContextEncodings,
  evaluateProjectIndexing,
  LegacyQueryBaseline,
  type RetrievalRecord,
} from "../../../../../scripts/evaluate-project-indexing.ts";
import { readSourceUnit } from "../extraction/source.ts";
import { openExistingKnowledgeStore, openKnowledgeStore } from "../persistence/KnowledgeStore.ts";
import { queryProjectContext } from "../query/ProjectContextQuery.ts";
import { createSyntheticGitRepository, syntheticGit } from "./SyntheticGitFixture.ts";
import {
  extractSyntheticIndexFixture,
  publishSyntheticIndexFixture,
  readSyntheticIndexCorpus,
  syntheticIndexScope,
} from "./SyntheticIndexFixture.ts";
const isQueryResult = Schema.is(ProjectIndexQueryResultV1);
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));
const decodeBaseline = Schema.decodeSync(Schema.fromJsonString(LegacyQueryBaseline));
it.live("keeps linked Git worktrees isolated while excluding both private indexes from Git", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() => createSyntheticGitRepository());
    const linked = `${root}-linked`;
    try {
      const mainSource = "export function mainOnly() { return 1; }\n";
      const linkedSource = "export function linkedOnly() { return 2; }\n";
      yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(root, "source.ts"), mainSource));
      yield* Effect.promise(() => syntheticGit(root, ["add", "--", "source.ts"]));
      yield* Effect.promise(() =>
        syntheticGit(root, ["commit", "--quiet", "-m", "Synthetic worktree baseline"]),
      );
      yield* Effect.promise(() =>
        syntheticGit(root, ["worktree", "add", "--quiet", "-b", "synthetic-linked", linked]),
      );
      const mainBatch = yield* Effect.promise(() =>
        extractSyntheticIndexFixture(root, [{ path: "source.ts", content: mainSource }]),
      );
      const linkedBatch = yield* Effect.promise(() =>
        extractSyntheticIndexFixture(linked, [{ path: "source.ts", content: linkedSource }]),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const mainStore = yield* openKnowledgeStore({ workspaceRoot: root });
          const linkedStore = yield* openKnowledgeStore({ workspaceRoot: linked });
          yield* publishSyntheticIndexFixture(mainStore, mainBatch, "main-worktree");
          yield* publishSyntheticIndexFixture(linkedStore, linkedBatch, "linked-worktree");
          expect(mainStore.workspace.workspaceId).not.toBe(linkedStore.workspace.workspaceId);
          const first = yield* queryProjectContext({
            scope: syntheticIndexScope(mainStore),
            workspaceRoot: root,
            reader: mainStore,
            input: { operation: "search", text: "linkedOnly" },
          });
          const second = yield* queryProjectContext({
            scope: syntheticIndexScope(linkedStore),
            workspaceRoot: linked,
            reader: linkedStore,
            input: { operation: "search", text: "linkedOnly" },
          });
          expect(first.entities).toEqual([]);
          expect(second.entities.some((entity) => entity.name === "linkedOnly")).toBe(true);
          for (const workspaceRoot of [root, linked])
            yield* Effect.promise(() =>
              syntheticGit(workspaceRoot, [
                "check-ignore",
                "--quiet",
                ".t3/knowledge/knowledge.sqlite",
              ]),
            );
        }),
      );
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(linked, { recursive: true, force: true }));
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  }),
);
it.live(
  "measures actual parser/compiler/store task retrieval for all eight failure/corrected pairs",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-query-evaluation-")),
      );
      const corpus = yield* Effect.promise(() => readSyntheticIndexCorpus());
      const baseline = yield* Effect.promise(async () =>
        decodeBaseline(
          await NodeFSP.readFile(
            new URL(
              "../../../../../scripts/project-indexing-evaluation/legacy-query-baseline.json",
              import.meta.url,
            ),
            "utf8",
          ),
        ),
      );
      const retrievals: RetrievalRecord[] = [];
      try {
        for (const entry of corpus.cases) {
          for (const variant of ["failure", "corrected"] as const) {
            const workspaceRoot = NodePath.join(root, entry.id, variant);
            const batch = yield* Effect.promise(() =>
              extractSyntheticIndexFixture(workspaceRoot, entry[variant].files),
            );
            const result = yield* Effect.scoped(
              Effect.gen(function* () {
                const store = yield* openKnowledgeStore({ workspaceRoot });
                yield* publishSyntheticIndexFixture(store, batch, `${entry.id}:${variant}`);
                const reader = yield* openExistingKnowledgeStore({ workspaceRoot });
                return yield* queryProjectContext({
                  scope: syntheticIndexScope(store),
                  workspaceRoot,
                  input: { operation: "task", text: entry.task, maxTokens: 24000 },
                  reader,
                });
              }),
            );
            expect(isQueryResult(result)).toBe(true);
            expect(
              compareContextEncodings(result).measurements.compactJsonTokens,
            ).toBeLessThanOrEqual(24000);
            const evidencePaths = [
              ...new Set(result.evidence.map((evidence) => evidence.filePath)),
            ];
            const sources = yield* Effect.promise(() =>
              Promise.all(
                evidencePaths.map(async (filePath) => {
                  const evidence = result.evidence.find(
                    (candidate) => candidate.filePath === filePath,
                  )!;
                  return {
                    path: filePath,
                    content: await readSourceUnit({
                      root: workspaceRoot,
                      filePath,
                      expectedHash: evidence.sourceHash,
                    }),
                  };
                }),
              ),
            );
            retrievals.push({
              caseId: entry.id,
              variant,
              context: { query: result, sources },
              evidencePaths,
              rankedPaths: [...new Set(result.entities.map((entity) => entity.filePath))],
              queryTokens: result.estimatedTokens,
            });
          }
        }
        const report = yield* Effect.promise(() =>
          evaluateProjectIndexing({ corpus, retrievals, baseline }),
        );
        expect(report.cases).toHaveLength(16);
        expect(report.contextSource).toBe("index-query-capture");
        expect(report.liveModelCalls).toBe(0);
        expect(report.qualityStatus).toBe("not-evaluated");
        expect(report.baselineComparison?.passes).toBe(true);
        const outputFile = process.env.T3CODE_PROJECT_INDEX_EVALUATION_OUTPUT;
        if (outputFile) {
          yield* Effect.promise(() => NodeFSP.writeFile(outputFile, `${encodeJson(retrievals)}\n`));
        }
        for (const entry of report.cases) {
          expect(
            entry.retrieval.missingPaths,
            `${entry.caseId}:${entry.variant} required source evidence`,
          ).toEqual([]);
        }
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
it.live(
  "isolates identical source paths in separate workspaces and rejects source edits and old cursors",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-index-query-isolation-")),
      );
      try {
        const firstRoot = NodePath.join(root, "first");
        const secondRoot = NodePath.join(root, "second");
        const firstBatch = yield* Effect.promise(() =>
          extractSyntheticIndexFixture(firstRoot, [
            {
              path: "src/source.ts",
              content:
                "export function firstOnly() { return 1; }\nexport function another() { return 2; }\n",
            },
          ]),
        );
        const secondBatch = yield* Effect.promise(() =>
          extractSyntheticIndexFixture(secondRoot, [
            { path: "src/source.ts", content: "export function secondOnly() { return 3; }\n" },
          ]),
        );
        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* openKnowledgeStore({ workspaceRoot: firstRoot });
            const second = yield* openKnowledgeStore({ workspaceRoot: secondRoot });
            yield* publishSyntheticIndexFixture(first, firstBatch, "first");
            yield* publishSyntheticIndexFixture(second, secondBatch, "second");
            const firstScope = syntheticIndexScope(first);
            const secondScope = syntheticIndexScope(second);
            const query = (text: string) =>
              queryProjectContext({
                scope: firstScope,
                workspaceRoot: firstRoot,
                input: { operation: "search", text },
                reader: first,
              });
            expect(
              (yield* query("firstOnly")).entities.some((entity) => entity.name === "firstOnly"),
            ).toBe(true);
            expect((yield* query("secondOnly")).entities).toEqual([]);
            const mismatch = yield* queryProjectContext({
              scope: secondScope,
              workspaceRoot: secondRoot,
              input: { operation: "overview" },
              reader: first,
            }).pipe(Effect.flip);
            expect(mismatch.code).toBe("scope-mismatch");
            const page = yield* queryProjectContext({
              scope: firstScope,
              workspaceRoot: firstRoot,
              input: { operation: "overview", limit: 1 },
              reader: first,
            });
            expect(page.nextCursor).not.toBeNull();
            yield* publishSyntheticIndexFixture(first, firstBatch, "next-revision");
            const oldCursor = yield* queryProjectContext({
              scope: firstScope,
              workspaceRoot: firstRoot,
              input: { operation: "overview", limit: 1, cursor: page.nextCursor! },
              reader: first,
            }).pipe(Effect.flip);
            expect(oldCursor.code).toBe("invalid-cursor");
            yield* Effect.promise(() =>
              NodeFSP.writeFile(
                NodePath.join(firstRoot, "src/source.ts"),
                "export function replacement() { return 9; }\n",
              ),
            );
            const stale = yield* query("firstOnly");
            expect(stale.entities).toEqual([]);
            expect(stale.gaps.some((gap) => gap.kind === "stale-source")).toBe(true);
            expect(
              (yield* queryProjectContext({
                scope: secondScope,
                workspaceRoot: secondRoot,
                input: { operation: "search", text: "secondOnly" },
                reader: second,
              })).entities.some((entity) => entity.name === "secondOnly"),
            ).toBe(true);
            yield* first.clear();
            expect((yield* first.getSettings()).enabled).toBe(false);
            expect((yield* query("firstOnly").pipe(Effect.flip)).code).toBe("disabled");
            expect(
              yield* Effect.promise(() =>
                NodeFSP.readFile(NodePath.join(firstRoot, "src/source.ts"), "utf8"),
              ),
            ).toContain("replacement");
          }),
        );
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
