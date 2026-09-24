// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import type {
  ProjectCallsiteV1,
  ProjectEntityV1,
  ProjectImportV1,
  ProjectModuleV1,
  ProjectRuleV1,
  ProjectSourceFileV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";

import { openKnowledgeStore, type KnowledgeStore } from "./KnowledgeStore.ts";

const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0)) NodeFS.rmSync(path, { recursive: true, force: true });
});
const range = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 12 };
const file = (
  path: string,
  classification: ProjectSourceFileV1["classification"] = "source",
): ProjectSourceFileV1 => ({
  path,
  contentHash: "hash",
  language: "typescript",
  bytes: 12,
  classification,
  status: "indexed",
  configDependencies: [],
});
const entity = (id: string, filePath = `${id}.ts`, sourceHash = "hash"): ProjectEntityV1 => ({
  id,
  filePath,
  sourceHash,
  kind: "function",
  name: id,
  qualifiedName: id,
  language: "typescript",
  range,
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});
const callsite: ProjectCallsiteV1 = {
  id: "call-target",
  callerEntityId: "source",
  filePath: "source.ts",
  sourceHash: "hash",
  range,
  expression: "target()",
  dispatch: "direct",
  resolution: "resolved",
  targetEntityIds: ["target"],
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
};
const importRecord: ProjectImportV1 = {
  id: "import-target",
  filePath: "source.ts",
  sourceHash: "hash",
  range,
  importText: "import { target } from './target'",
  specifier: "./target",
  resolution: "workspace",
  targetPath: "target.ts",
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
};
const moduleRecord: ProjectModuleV1 = {
  id: "package",
  name: "example-package",
  summary: "Package manifest at package.json",
  entityIds: [],
  filePaths: ["package.json"],
  dependsOnModuleIds: [],
  provenance: "parser",
  freshness: "current",
  evidenceIds: ["manifest-evidence"],
};
const rule: ProjectRuleV1 = {
  id: "explicit-rule",
  name: "AGENTS.md",
  description: "Use the package convention.",
  severity: "info",
  source: "explicit",
  appliesToEntityIds: ["source"],
  provenance: "parser",
  freshness: "current",
  evidenceIds: ["rule-evidence"],
};

function withStore<A, E, R>(run: (store: KnowledgeStore) => Effect.Effect<A, E, R>) {
  const workspaceRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-static-reset-"));
  roots.push(workspaceRoot);
  return Effect.scoped(
    Effect.gen(function* () {
      const store = yield* openKnowledgeStore({ workspaceRoot });
      return yield* run(store);
    }),
  );
}

describe("static structural refresh", () => {
  it.effect(
    "replaces manifest, rule, call, and import facts while preserving the published revision",
    () =>
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
              files: [
                file("source.ts"),
                file("target.ts"),
                file("package.json", "manifest"),
                file("AGENTS.md", "rule"),
              ],
              entities: [entity("source", "source.ts"), entity("target", "target.ts")],
              callsites: [callsite],
              imports: [importRecord],
              modules: [moduleRecord],
              rules: [rule],
              evidence: [
                {
                  id: "manifest-evidence",
                  filePath: "package.json",
                  sourceHash: "hash",
                  range,
                  provenance: "parser",
                },
                {
                  id: "rule-evidence",
                  filePath: "AGENTS.md",
                  sourceHash: "hash",
                  range,
                  provenance: "parser",
                },
              ],
            },
          });
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
          yield* store.applyBatch({
            lease,
            revision: second.revision,
            batch: {},
            resetStructuralFilePaths: ["target.ts", "package.json", "AGENTS.md"],
          });
          for (const [kind, id] of [
            ["entities", "target"],
            ["callsites", "call-target"],
            ["imports", "import-target"],
            ["modules", "package"],
            ["rules", "explicit-rule"],
            ["evidence", "manifest-evidence"],
            ["evidence", "rule-evidence"],
          ] as const) {
            expect(yield* store.getRecord(kind, id, second.revision)).toBeNull();
            expect(yield* store.getRecord(kind, id, first.revision)).not.toBeNull();
          }
          expect(yield* store.getRecord("entities", "source", second.revision)).not.toBeNull();
          expect(
            (yield* store.listCalls({
              revision: second.revision,
              entityIds: ["target"],
              direction: "callers",
            })).items,
          ).toEqual([]);
        }),
      ),
  );

  it.effect("rolls back a failed replacement and permits a later reset", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "first",
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: { files: [file("source.ts")], entities: [entity("source", "source.ts")] },
        });
        const failed = yield* Effect.flip(
          store.applyBatch({
            lease,
            revision,
            resetStructuralFilePaths: ["source.ts"],
            batch: { entities: [entity("replacement", "source.ts", "wrong-hash")] },
          }),
        );
        expect(failed.code).toBe("stale-source");
        expect(yield* store.getRecord("entities", "source", revision)).not.toBeNull();
        yield* store.applyBatch({
          lease,
          revision,
          resetStructuralFilePaths: ["source.ts"],
          batch: {},
        });
        expect(yield* store.getRecord("entities", "source", revision)).toBeNull();
      }),
    ),
  );

  it.effect("keeps an unchanged explicit rule when a referenced source file changes", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "first",
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: {
            files: [file("source.ts"), file("AGENTS.md", "rule")],
            entities: [entity("source", "source.ts")],
            evidence: [
              {
                id: "rule-evidence",
                filePath: "AGENTS.md",
                sourceHash: "hash",
                range,
                provenance: "parser",
              },
            ],
            rules: [rule],
          },
        });
        yield* store.applyBatch({
          lease,
          revision,
          resetStructuralFilePaths: ["source.ts"],
          batch: {},
        });
        expect(yield* store.getRecord("rules", rule.id, revision)).not.toBeNull();
        expect(yield* store.getRecord("evidence", "rule-evidence", revision)).not.toBeNull();
      }),
    ),
  );

  it.effect("removes deleted targets and rejects private or excluded reset paths", () =>
    withStore((store) =>
      Effect.gen(function* () {
        const lease = yield* store.acquireLease("writer");
        const { revision } = yield* store.beginGeneration({
          lease,
          expectedRevision: 0,
          idempotencyKey: "first",
        });
        yield* store.applyBatch({
          lease,
          revision,
          batch: { files: [file("source.ts"), file("target.ts")], imports: [importRecord] },
        });
        expect(
          (yield* Effect.flip(
            store.applyBatch({
              lease,
              revision,
              batch: {},
              resetStructuralFilePaths: ["chat-archive.json"],
            }),
          )).code,
        ).toBe("invalid-reset");
        yield* store.applyBatch({
          lease,
          revision,
          removeFilePaths: ["target.ts"],
          batch: {
            files: [
              {
                ...file("target.ts", "ignored"),
                status: "skipped",
                contentHash: "unread",
                bytes: 0,
              },
            ],
          },
        });
        expect((yield* store.listRecords({ kind: "imports", revision })).items).toEqual([]);
        expect(
          (yield* Effect.flip(
            store.applyBatch({
              lease,
              revision,
              batch: {},
              resetStructuralFilePaths: ["target.ts"],
            }),
          )).code,
        ).toBe("invalid-reset");
      }),
    ),
  );
});
