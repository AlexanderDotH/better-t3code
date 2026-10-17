import * as NodeTimersPromises from "node:timers/promises";

import { expect, it } from "@effect/vitest";
import { EnvironmentId, KnowledgeGraphScopeId, ProjectId } from "@t3tools/contracts";

import {
  buildDeterministicKnowledgeGraph,
  type KnowledgeGraphDeterministicExtractionInput,
} from "./KnowledgeGraphDeterministicExtractor.ts";

const input = {
  scope: {
    version: 1,
    scopeId: KnowledgeGraphScopeId.make("kg:streaming-test"),
    environmentId: EnvironmentId.make("environment-test"),
    projectId: ProjectId.make("project-test"),
    effectiveWorkspaceRoot: "/workspace",
    isWorktree: false,
  },
  files: ["a.ts", "b.ts", "c.ts"].map((path) => ({
    path,
    content: "export const value = 1;\n",
    sizeBytes: 24,
    modifiedAtMs: 0,
  })),
  coChangeGroups: [["a.ts", "b.ts"]],
  maxNodes: 100,
  omittedFileCount: 0,
  seenGeneration: 1,
} satisfies KnowledgeGraphDeterministicExtractionInput;

it("keeps ready I/O responsive while extracting a graph", async () => {
  let completed = false;
  const extraction = buildDeterministicKnowledgeGraph(input, new AbortController().signal).then(
    (result) => {
      completed = true;
      return result;
    },
  );

  await NodeTimersPromises.setImmediate();
  expect(completed).toBe(false);

  const result = await extraction;
  expect(result.fileFingerprints.map((file) => file.path)).toEqual(["a.ts", "b.ts", "c.ts"]);
  expect(result.edges.some((edge) => edge.kind === "co-changes-with")).toBe(true);
});

it("cancels extraction at an I/O boundary", async () => {
  const controller = new AbortController();
  const extraction = buildDeterministicKnowledgeGraph(input, controller.signal);
  const rejected = expect(extraction).rejects.toMatchObject({ name: "AbortError" });

  await NodeTimersPromises.setImmediate();
  controller.abort();

  await rejected;
});
