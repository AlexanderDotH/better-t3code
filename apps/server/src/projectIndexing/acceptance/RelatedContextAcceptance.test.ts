// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { openKnowledgeStore } from "../persistence/KnowledgeStore.ts";
import { queryProjectContext } from "../query/ProjectContextQuery.ts";
import {
  extractSyntheticIndexFixture,
  publishSyntheticIndexFixture,
  syntheticIndexScope,
} from "./SyntheticIndexFixture.ts";

const sourceFiles = [
  {
    path: "src/validation.ts",
    content:
      'export function validate(value: number) {\n  if (value < 0) throw new Error("negative");\n  return value;\n}\n',
  },
  {
    path: "src/processor.ts",
    content:
      'import { validate } from "./validation";\nexport function processItem(value: number) { return validate(value); }\n',
  },
  {
    path: "tests/processor.test.ts",
    content:
      'import { processItem } from "../src/processor";\nexport function verifiesProcessor() { return processItem(1); }\n',
  },
  {
    path: "tests/unrelated.test.ts",
    content: 'export const unrelated = "manual test note";\n',
  },
];

it.live(
  "returns bounded confirmed imports and calls without treating an unrelated test as a relationship",
  () =>
    Effect.gen(function* () {
      const root = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-related-context-")),
      );
      try {
        const batch = yield* Effect.promise(() => extractSyntheticIndexFixture(root, sourceFiles));
        yield* Effect.scoped(
          Effect.gen(function* () {
            const store = yield* openKnowledgeStore({ workspaceRoot: root });
            yield* publishSyntheticIndexFixture(store, batch, "related-context");
            const scope = syntheticIndexScope(store);
            const result = yield* queryProjectContext({
              scope,
              workspaceRoot: root,
              reader: store,
              input: { operation: "task", text: "processItem", maxTokens: 6000 },
            });
            expect(result.estimatedTokens).toBeLessThanOrEqual(6000);
            expect(result.entities.some((entity) => entity.name === "processItem")).toBe(true);
            expect(
              (result.imports ?? []).some(
                (record) =>
                  record.filePath === "src/processor.ts" &&
                  record.resolution === "workspace" &&
                  record.targetPath === "src/validation.ts",
              ),
            ).toBe(true);
            const processor = batch.entities?.find((entity) => entity.name === "processItem");
            if (!processor) throw new Error("Expected the processor symbol");
            const focused = yield* queryProjectContext({
              scope,
              workspaceRoot: root,
              reader: store,
              input: {
                operation: "entity",
                entityId: processor.id,
                maxTokens: 12000,
              },
            });
            expect(
              (focused.imports ?? []).some(
                (record) =>
                  record.filePath === "tests/processor.test.ts" &&
                  record.resolution === "workspace" &&
                  record.targetPath === "src/processor.ts",
              ),
            ).toBe(true);
            expect(
              (result.imports ?? []).every(
                (record) => record.filePath !== "tests/unrelated.test.ts",
              ),
            ).toBe(true);
            yield* Effect.promise(() =>
              NodeFSP.writeFile(
                NodePath.join(root, "src/processor.ts"),
                "export function changed() { return 99; }\n",
              ),
            );
            const stale = yield* queryProjectContext({
              scope,
              workspaceRoot: root,
              reader: store,
              input: { operation: "task", text: "processItem", maxTokens: 6000 },
            });
            expect(stale.entities.every((entity) => entity.filePath !== "src/processor.ts")).toBe(
              true,
            );
            expect(stale.gaps.some((gap) => gap.kind === "stale-source")).toBe(true);
          }),
        );
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true }));
      }
    }),
);
