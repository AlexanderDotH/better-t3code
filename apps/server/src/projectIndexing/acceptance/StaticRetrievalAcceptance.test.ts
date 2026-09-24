// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { expect, it } from "@effect/vitest";

import {
  evaluateStaticRetrieval,
  StaticRetrievalCorpus,
  type StaticRetrievalCapture,
} from "../../../../../scripts/project-indexing-evaluation/static-retrieval.ts";
import { openKnowledgeStore } from "../persistence/KnowledgeStore.ts";
import { queryProjectContext } from "../query/ProjectContextQuery.ts";
import {
  extractSyntheticIndexFixture,
  publishSyntheticIndexFixture,
  syntheticIndexScope,
} from "./SyntheticIndexFixture.ts";

const decodeCorpus = Schema.decodeSync(Schema.fromJsonString(StaticRetrievalCorpus));
const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

it.live("finds source and applicable original rules in the first results within 6,000 tokens", () =>
  Effect.gen(function* () {
    const corpus = yield* Effect.promise(async () =>
      decodeCorpus(
        await NodeFSP.readFile(
          new URL(
            "../../../../../scripts/project-indexing-evaluation/static-retrieval-cases.json",
            import.meta.url,
          ),
          "utf8",
        ),
      ),
    );
    const root = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-static-retrieval-")),
    );
    const captures: StaticRetrievalCapture[] = [];
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
              return yield* queryProjectContext({
                scope: syntheticIndexScope(store),
                workspaceRoot,
                reader: store,
                input: { operation: "task", text: entry.task, maxTokens: entry.maxTokens },
              });
            }),
          );
          const ruleEvidenceIds = new Set(result.rules.flatMap((rule) => rule.evidenceIds));
          captures.push({
            caseId: entry.id,
            variant,
            rankedPaths: [...new Set(result.entities.map((entity) => entity.filePath))],
            evidencePaths: [...new Set(result.evidence.map((evidence) => evidence.filePath))],
            rulePaths: [
              ...new Set(
                result.evidence
                  .filter((evidence) => ruleEvidenceIds.has(evidence.id))
                  .map((evidence) => evidence.filePath),
              ),
            ],
            queryTokens: result.estimatedTokens,
          });
        }
      }
      const report = evaluateStaticRetrieval(corpus, captures);
      const outputFile = process.env.T3CODE_STATIC_RETRIEVAL_OUTPUT;
      if (outputFile)
        yield* Effect.promise(() => NodeFSP.writeFile(outputFile, `${encodeJson(captures)}\n`));
      expect(report.totalCases).toBe(4);
      expect(report.passes, encodeJson(report.cases)).toBe(true);
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  }),
);

it.live("names an applicable original rule file when its text exceeds the context budget", () =>
  Effect.gen(function* () {
    const root = yield* Effect.promise(() =>
      NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-static-rule-budget-")),
    );
    try {
      const longRules = Array.from(
        { length: 1500 },
        (_, index) => `Rule ${index}: preserve result evidence ${index}.`,
      ).join("\n");
      const batch = yield* Effect.promise(() =>
        extractSyntheticIndexFixture(root, [
          { path: "AGENTS.md", content: `${longRules}\n` },
          {
            path: "src/result.ts",
            content: "export function result() { return 1; }\n",
          },
        ]),
      );
      yield* Effect.scoped(
        Effect.gen(function* () {
          const store = yield* openKnowledgeStore({ workspaceRoot: root });
          yield* publishSyntheticIndexFixture(store, batch, "large-original-rule");
          const result = yield* queryProjectContext({
            scope: syntheticIndexScope(store),
            workspaceRoot: root,
            reader: store,
            input: { operation: "task", text: "result", maxTokens: 2000 },
          });
          expect(result.estimatedTokens).toBeLessThanOrEqual(2000);
          expect(
            result.gaps.some(
              (gap) => gap.filePath === "AGENTS.md" && gap.message.includes("Read its rule file"),
            ),
          ).toBe(true);
        }),
      );
    } finally {
      yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
    }
  }),
);
