// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { it } from "@effect/vitest";
import type { ProjectImportV1, ProjectModuleV1, ProjectSourceFileV1 } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { afterEach, describe, expect } from "vite-plus/test";

import { openKnowledgeStore } from "./KnowledgeStore.ts";

const roots: string[] = [];
afterEach(() => {
  for (const path of roots.splice(0)) NodeFS.rmSync(path, { recursive: true, force: true });
});
const range = { startLine: 1, startColumn: 1, endLine: 1, endColumn: 24 };
const file = (
  path: string,
  classification: ProjectSourceFileV1["classification"] = "source",
): ProjectSourceFileV1 => ({
  path,
  contentHash: "hash",
  language: "typescript",
  bytes: 24,
  classification,
  status: "indexed",
  configDependencies: [],
});
const moduleRecord = (id: string, path: string): ProjectModuleV1 => ({
  id,
  name: id,
  summary: `Package manifest at ${path}`,
  entityIds: [],
  filePaths: [path],
  dependsOnModuleIds: [],
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});
const importRecord = (id: string, targetPath: string): ProjectImportV1 => ({
  id,
  filePath: "apps/a/src/main.ts",
  sourceHash: "hash",
  range,
  importText: `import '${targetPath}'`,
  specifier: targetPath,
  resolution: "workspace",
  targetPath,
  provenance: "parser",
  freshness: "current",
  evidenceIds: [],
});

describe("manifest package dependencies", () => {
  it.effect("derives sorted cross-package edges and removes them after a target deletion", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const workspaceRoot = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "t3-packages-"));
        roots.push(workspaceRoot);
        const store = yield* openKnowledgeStore({ workspaceRoot });
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
              file("apps/a/package.json", "manifest"),
              file("apps/b/package.json", "manifest"),
              file("apps/c/package.json", "manifest"),
              file("apps/a/src/main.ts"),
              file("apps/b/src/util.ts"),
              file("apps/c/src/util.ts"),
            ],
            modules: [
              moduleRecord("module-a", "apps/a/package.json"),
              moduleRecord("module-b", "apps/b/package.json"),
              moduleRecord("module-c", "apps/c/package.json"),
            ],
            imports: [
              importRecord("z-to-c", "apps/c/src/util.ts"),
              importRecord("a-to-b", "apps/b/src/util.ts"),
              importRecord("self", "apps/a/src/main.ts"),
            ],
          },
        });
        expect(yield* store.refreshModuleDependencies({ lease, revision: first.revision })).toEqual(
          { moduleCount: 3, dependencyCount: 2 },
        );
        expect(
          (yield* store.getRecord("modules", "module-a", first.revision))?.dependsOnModuleIds,
        ).toEqual(["module-b", "module-c"]);
        expect(
          (yield* store.getRecord("modules", "module-b", first.revision))?.dependsOnModuleIds,
        ).toEqual([]);
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
          removeFilePaths: ["apps/b/src/util.ts"],
        });
        expect(
          yield* store.refreshModuleDependencies({ lease, revision: second.revision }),
        ).toEqual({ moduleCount: 3, dependencyCount: 1 });
        expect(
          (yield* store.getRecord("modules", "module-a", second.revision))?.dependsOnModuleIds,
        ).toEqual(["module-c"]);
        expect(
          (yield* store.getRecord("modules", "module-a", first.revision))?.dependsOnModuleIds,
        ).toEqual(["module-b", "module-c"]);
      }),
    ),
  );
});
