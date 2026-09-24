import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  PROJECT_INDEX_MAX_VISIBLE_ENTITIES,
  ProjectId,
  type ProjectCallsiteV1,
  type ProjectEntityV1,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { mobileProjectIndexGraphView } from "./mobile-project-index-graph";
import { captureMobileProjectIndexEntity } from "./mobile-project-index-detail";

const range = { startLine: 4, startColumn: 1, endLine: 12, endColumn: 2 };
const entity = (id: string, patch: Partial<ProjectEntityV1> = {}): ProjectEntityV1 => ({
  id,
  filePath: "src/example.ts",
  kind: "function",
  name: id,
  qualifiedName: id,
  language: "typescript",
  range,
  sourceHash: "hash",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
  ...patch,
});
const callsite = (patch: Partial<ProjectCallsiteV1> = {}): ProjectCallsiteV1 => ({
  id: "call-1",
  callerEntityId: "caller",
  filePath: "src/example.ts",
  range,
  expression: "target()",
  dispatch: "direct",
  resolution: "resolved",
  targetEntityIds: ["target"],
  sourceHash: "hash",
  provenance: "compiler",
  freshness: "current",
  evidenceIds: [],
  ...patch,
});
const result = (
  entities: ProjectEntityV1[],
  callsites: ProjectCallsiteV1[] = [],
): ProjectIndexQueryResultV1 => ({
  version: 1,
  scope: {
    scopeId: "scope-1",
    projectId: ProjectId.make("project-1"),
    workspaceFingerprint: "workspace-1",
  },
  revision: 3,
  operation: "overview",
  summary: "",
  entities,
  callsites,
  modules: [],
  behaviors: [],
  flows: [],
  rules: [],
  evidence: [],
  gaps: [],
  coverage: EMPTY_PROJECT_INDEX_COVERAGE,
  nextCursor: null,
  truncated: false,
  estimatedTokens: 100,
});

describe("mobile project index graph", () => {
  it("preserves entity identity and exact source ranges through canvas projection", () => {
    const longId = `method-${"x".repeat(300)}`;
    const graph = mobileProjectIndexGraphView(result([entity(longId, { kind: "method" })]));
    const node = graph.view.nodes[0]!;

    expect(graph.nodeEntityIds.get(node.nodeId)).toBe(longId);
    expect(node.nodeId.length).toBeLessThan(256);
    expect(node.source).toEqual({
      path: "src/example.ts",
      startLine: 4,
      endLine: 12,
      symbol: longId,
    });
  });

  it("draws only resolved source-backed calls", () => {
    const graph = mobileProjectIndexGraphView(
      result(
        [entity("caller"), entity("target")],
        [
          callsite(),
          callsite({ id: "candidate", resolution: "candidate", provenance: "llm" }),
          callsite({ id: "unresolved", resolution: "unresolved", targetEntityIds: [] }),
        ],
      ),
    );

    expect(graph.view.edges).toHaveLength(1);
    expect(graph.view.edges.map((edge) => [edge.provenance, edge.confidence])).toEqual([
      ["deterministic", 1],
    ]);
  });

  it("keeps large graph results bounded while retaining the selected entity", () => {
    const entities = Array.from({ length: 200 }, (_, index) => entity(`entity-${index}`));
    const graph = mobileProjectIndexGraphView(
      result(
        entities,
        Array.from({ length: 600 }, (_, index) =>
          callsite({
            id: `call-${index}`,
            callerEntityId: "entity-0",
            resolution: "candidate",
            targetEntityIds: entities.slice(1).map((entry) => entry.id),
          }),
        ),
      ),
      "entity-199",
    );

    expect(graph.view.nodes).toHaveLength(PROJECT_INDEX_MAX_VISIBLE_ENTITIES);
    expect(graph.entityNodeIds.has("entity-199")).toBe(true);
    expect(graph.view.edges.length).toBeLessThanOrEqual(KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES);
    expect(graph.truncated).toBe(true);
    expect(graph.omittedEntities).toBe(50);
  });

  it("preserves incoming and outgoing call graphs when only the selected root is retained", () => {
    const initial = result([entity("caller"), entity("target")]);
    for (const [rootId, otherId, operation] of [
      ["target", "caller", "callers"],
      ["caller", "target", "callees"],
    ] as const) {
      const anchor = captureMobileProjectIndexEntity(initial, rootId);
      const page = { ...result([entity(otherId)], [callsite()]), operation };
      const graph = mobileProjectIndexGraphView(page, rootId, anchor);
      expect(graph.view.nodes).toHaveLength(2);
      expect(graph.view.edges).toHaveLength(1);
      expect(graph.nodeEntityIds.get(graph.view.edges[0]!.sourceNodeId)).toBe("caller");
      expect(graph.nodeEntityIds.get(graph.view.edges[0]!.targetNodeId)).toBe("target");
      expect(
        mobileProjectIndexGraphView({ ...page, revision: page.revision + 1 }, rootId, anchor).view
          .edges,
      ).toEqual([]);
    }
  });
});
