import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
  KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
  KnowledgeGraphScopeId,
  ProjectId,
  type KnowledgeGraphScopeV1,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import {
  extractKnowledgeGraphInventory,
  resolveKnowledgeGraphInventoryBounds,
} from "./KnowledgeGraphInventory.ts";

const scope = {
  version: 1,
  scopeId: KnowledgeGraphScopeId.make("kg:test"),
  environmentId: EnvironmentId.make("env-test"),
  projectId: ProjectId.make("project-test"),
  effectiveWorkspaceRoot: "/workspace",
  isWorktree: false,
} satisfies KnowledgeGraphScopeV1;

it("pins the production file and node bounds as the inventory defaults", () => {
  expect(KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES).toBe(25_000);
  expect(KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE).toBe(100_000);
  expect(resolveKnowledgeGraphInventoryBounds({})).toEqual({
    maxEligibleFiles: KNOWLEDGE_GRAPH_MAX_ELIGIBLE_FILES,
    maxNodes: KNOWLEDGE_GRAPH_MAX_NODES_PER_SCOPE,
  });
});

const writeTextFile = Effect.fn("KnowledgeGraphInventoryTest.writeTextFile")(function* (
  workspaceRoot: string,
  relativePath: string,
  contents: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const absolutePath = path.join(workspaceRoot, relativePath);
  yield* fileSystem.makeDirectory(path.dirname(absolutePath), { recursive: true });
  yield* fileSystem.writeFileString(absolutePath, contents);
});

it.effect("extracts a bounded deterministic graph without reading ignored secrets", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-knowledge-graph-inventory-",
      });
      yield* Effect.forEach(
        [
          [
            "package.json",
            JSON.stringify({
              name: "inventory-fixture",
              dependencies: { react: "19.0.0" },
              devDependencies: { typescript: "5.9.0" },
            }),
          ],
          [
            "src/index.ts",
            'import React from "react";\nimport { Service } from "./service";\nexport function start() { return new Service(); }\n',
          ],
          ["src/service.ts", "export class Service { run() { return true; } }\n"],
          ["README.md", "# Inventory fixture\n"],
          ["docs/architecture.md", "# Architecture\nThe service owns indexing.\n"],
          [
            "config/app.json",
            JSON.stringify({
              apiKey: "must-not-leak-json",
              awsAccessKeyId: "AKIAABCDEFGHIJKLMNOP",
              databaseUrl: "postgres://inventory-user:db-must-not-leak@example.test/app",
              endpoint: "https://example.test",
              providerExample: "sk-proj-must-not-leak",
            }),
          ],
          [".env", "OPENAI_API_KEY=must-not-leak\n"],
          ["config/secrets.json", '{"token":"must-not-leak"}'],
          ["node_modules/react/index.js", "export default {};\n"],
        ] as const,
        ([relativePath, contents]) => writeTextFile(workspaceRoot, relativePath, contents),
      );

      const first = yield* extractKnowledgeGraphInventory({
        scope: { ...scope, effectiveWorkspaceRoot: workspaceRoot },
        workspaceRoot,
        coChangeGroups: [["src/index.ts", "src/service.ts"]],
        seenGeneration: 4,
      });
      const second = yield* extractKnowledgeGraphInventory({
        scope: { ...scope, effectiveWorkspaceRoot: workspaceRoot },
        workspaceRoot,
        coChangeGroups: [["src/index.ts", "src/service.ts"]],
        seenGeneration: 4,
      });

      expect(first).toEqual(second);
      expect(new Set(first.nodes.map((node) => node.kind))).toEqual(
        new Set([
          "repository",
          "package",
          "directory",
          "file",
          "symbol",
          "dependency",
          "technology",
          "documentation",
          "architecture",
        ]),
      );
      for (const edgeKind of [
        "contains",
        "declares",
        "imports",
        "depends-on",
        "uses",
        "documents",
        "configures",
        "co-changes-with",
      ] as const) {
        expect(first.edges.some((edge) => edge.kind === edgeKind)).toBe(true);
      }
      expect(first.fileFingerprints.map(({ path }) => path)).toEqual([
        "README.md",
        "config/app.json",
        "docs/architecture.md",
        "package.json",
        "src/index.ts",
        "src/service.ts",
      ]);
      expect(JSON.stringify(first)).not.toContain("must-not-leak");
      expect(JSON.stringify(first)).not.toContain("must-not-leak-json");
      expect(JSON.stringify(first)).not.toContain("AKIAABCDEFGHIJKLMNOP");
      expect(JSON.stringify(first)).not.toContain("db-must-not-leak");
      expect(JSON.stringify(first)).not.toContain("sk-proj-must-not-leak");
      expect(first.truncation).toEqual({
        eligibleFiles: false,
        nodes: false,
        visibleNodes: false,
        omittedFileCount: 0,
        omittedNodeCount: 0,
      });
      expect(first.nodes.map(({ nodeId }) => nodeId)).toEqual(
        first.nodes.map(({ nodeId }) => nodeId).sort(),
      );
      expect(first.edges.map(({ edgeId }) => edgeId)).toEqual(
        first.edges.map(({ edgeId }) => edgeId).sort(),
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("records file and node truncation without exceeding either bound", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspaceRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-knowledge-graph-bounds-",
      });
      yield* Effect.forEach(["a.ts", "b.ts", "c.ts", "d.ts"], (relativePath) =>
        writeTextFile(workspaceRoot, relativePath, `export const ${relativePath[0]} = 1;`),
      );

      const result = yield* extractKnowledgeGraphInventory({
        scope: { ...scope, effectiveWorkspaceRoot: workspaceRoot },
        workspaceRoot,
        maxEligibleFiles: 2,
        maxNodes: 4,
        seenGeneration: 1,
      });

      expect(result.fileFingerprints).toHaveLength(2);
      expect(result.nodes.length).toBeLessThanOrEqual(4);
      expect(
        result.edges.every(
          (edge) =>
            result.nodes.some((node) => node.nodeId === edge.sourceNodeId) &&
            result.nodes.some((node) => node.nodeId === edge.targetNodeId),
        ),
      ).toBe(true);
      expect(result.truncation.eligibleFiles).toBe(true);
      expect(result.truncation.nodes).toBe(true);
      expect(result.truncation.omittedFileCount).toBe(2);
      expect(result.truncation.omittedNodeCount).toBeGreaterThan(0);
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);

it.effect("rejects a workspace alias instead of indexing outside the canonical scope root", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const tempRoot = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-knowledge-graph-canonical-root-",
      });
      const canonicalRoot = path.join(tempRoot, "canonical");
      const aliasedRoot = path.join(tempRoot, "alias");
      yield* fileSystem.makeDirectory(canonicalRoot);
      yield* writeTextFile(canonicalRoot, "src/index.ts", "export const indexed = true;\n");
      yield* fileSystem.symlink(canonicalRoot, aliasedRoot);

      const error = yield* extractKnowledgeGraphInventory({
        scope: { ...scope, effectiveWorkspaceRoot: aliasedRoot },
        workspaceRoot: aliasedRoot,
        coChangeGroups: [],
      }).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: "KnowledgeGraphInventoryError",
        operation: "validate-root",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  ),
);
