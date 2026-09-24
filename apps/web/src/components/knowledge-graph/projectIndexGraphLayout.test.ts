import {
  EMPTY_PROJECT_INDEX_COVERAGE,
  ProjectId,
  type ProjectCallsiteV1,
  type ProjectEntityV1,
  type ProjectIndexGraphOverviewV1,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { layoutProjectIndexGraph, PROJECT_INDEX_GRAPH_NODE_LIMIT } from "./projectIndexGraphLayout";
import {
  buildProjectIndexMap,
  layoutProjectIndexOverview,
  PROJECT_MAP_NODE_LIMIT,
  PROJECT_MAP_ROOT,
} from "./projectIndexOverviewLayout";

function entity(id: string): ProjectEntityV1 {
  return {
    id,
    name: id,
    qualifiedName: id,
    filePath: "src/project.ts",
    kind: "method",
    language: "typescript",
    range: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 1 },
    sourceHash: "hash",
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  };
}

function callsite(
  id: string,
  resolution: ProjectCallsiteV1["resolution"],
  targets: ReadonlyArray<string>,
): ProjectCallsiteV1 {
  return {
    id,
    callerEntityId: "caller",
    filePath: "src/project.ts",
    expression: "run()",
    dispatch: "virtual",
    range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 6 },
    resolution,
    targetEntityIds: targets,
    sourceHash: "hash",
    provenance: "compiler",
    freshness: "current",
    evidenceIds: [],
  };
}

describe("layoutProjectIndexGraph", () => {
  it("keeps a 64-folder overview stable, bounded, and linked to its published paths", () => {
    const snapshot: ProjectIndexGraphOverviewV1 = {
      basis: "published-index",
      rootPath: "",
      indexedFiles: 6_400,
      omittedFiles: 0,
      truncated: false,
      nodes: Array.from({ length: 64 }, (_, index) => ({
        path: "folder" + index,
        kind: "directory",
        fileCount: 100,
      })),
      edges: Array.from({ length: 63 }, (_, index) => ({
        source: "folder" + index,
        target: "folder" + (index + 1),
        imports: index + 1,
      })),
    };
    const map = buildProjectIndexMap(snapshot, new Map(), new Set());
    const graph = layoutProjectIndexOverview(map);
    expect(graph.nodes).toHaveLength(65);
    expect(graph.edges.filter((edge) => edge.kind === "imports")).toHaveLength(63);
    expect(graph.edges.filter((edge) => edge.kind === "contains")).toHaveLength(64);
    expect(layoutProjectIndexOverview(map).nodes).toEqual(graph.nodes);
    expect(new Set(graph.nodes.map((node) => node.x + ":" + node.y)).size).toBe(65);
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(node.freshness).toBeNull();
    }
    expect(snapshot.nodes[0]).not.toHaveProperty("x");
  });

  it("preserves uncertain call relationships and source containment without inventing unresolved targets", () => {
    const graph = layoutProjectIndexGraph(
      [entity("caller"), { ...entity("target"), containerId: "caller" }],
      [callsite("candidate", "candidate", ["target"]), callsite("unresolved", "unresolved", [])],
      null,
    );
    expect(graph.edges.map((edge) => edge.kind)).toEqual(["contains", "candidate"]);
    expect(graph.edges.some((edge) => edge.kind === "resolved")).toBe(false);
  });

  it("makes room for children, preserves sibling folders, and restores the collapsed map", () => {
    const overview: ProjectIndexGraphOverviewV1 = {
      basis: "published-index",
      rootPath: "",
      indexedFiles: 5000,
      omittedFiles: 0,
      truncated: false,
      nodes: Array.from({ length: 12 }, (_, index) => ({
        path: `folder${index}`,
        kind: "directory",
        fileCount: 100,
      })),
      edges: [],
    };
    const branch: ProjectIndexQueryResultV1 = {
      version: 1,
      operation: "overview",
      scope: {
        projectId: ProjectId.make("project"),
        scopeId: "scope",
        workspaceFingerprint: "workspace",
      },
      revision: 1,
      summary: "",
      coverage: EMPTY_PROJECT_INDEX_COVERAGE,
      estimatedTokens: 100,
      truncated: false,
      nextCursor: null,
      entities: [],
      callsites: [],
      imports: [],
      modules: [],
      behaviors: [],
      flows: [],
      rules: [],
      gaps: [],
      evidence: [],
      graph: {
        ...overview,
        rootPath: "folder0",
        nodes: Array.from({ length: 24 }, (_, index) => ({
          path: `folder0/file${index}.ts`,
          kind: "file",
          fileCount: 1,
        })),
      },
    };
    const closed = buildProjectIndexMap(overview, new Map(), new Set());
    const before = layoutProjectIndexOverview(closed);
    const expanded = buildProjectIndexMap(overview, new Map([["folder0", branch]]), new Set());
    const after = layoutProjectIndexOverview(expanded);
    expect(after.nodes).toHaveLength(before.nodes.length + 24);
    for (const node of before.nodes) expect(after.byId.has(node.id)).toBe(true);
    expect(after.edges.every((edge) => edge.kind === "contains")).toBe(true);
    expect(after.byId.get(PROJECT_MAP_ROOT)).toMatchObject({
      x: before.byId.get(PROJECT_MAP_ROOT)!.x,
      y: before.byId.get(PROJECT_MAP_ROOT)!.y,
    });
    const moved = before.nodes
      .filter((node) => node.id !== PROJECT_MAP_ROOT && node.id !== "folder0")
      .some((node) => {
        const next = after.byId.get(node.id)!;
        return Math.hypot(next.x - node.x, next.y - node.y) > 10;
      });
    expect(moved).toBe(true);
    expect(
      layoutProjectIndexOverview(buildProjectIndexMap(overview, new Map(), new Set())).nodes,
    ).toEqual(before.nodes);
    const hugeBranch = {
      ...branch,
      graph: {
        ...branch.graph!,
        nodes: Array.from({ length: 500 }, (_, index) => ({
          path: `folder0/file${index}.ts`,
          kind: "file" as const,
          fileCount: 1,
        })),
      },
    };
    const bounded = buildProjectIndexMap(overview, new Map([["folder0", hugeBranch]]), new Set());
    expect(bounded.nodes).toHaveLength(PROJECT_MAP_NODE_LIMIT);
    expect(bounded.truncated).toBe(true);
    for (const node of before.nodes)
      expect(bounded.nodes.some((next) => next.id === node.id)).toBe(true);
  });

  it("bounds entity and candidate-link work while keeping the selected entity visible", () => {
    const entities = [
      entity("caller"),
      ...Array.from({ length: 199 }, (_, index) => entity(`target-${index}`)),
    ];
    const calls = Array.from({ length: 200 }, (_, index) =>
      callsite(
        `call-${index}`,
        "candidate",
        entities.slice(1).map((target) => target.id),
      ),
    );
    const graph = layoutProjectIndexGraph(entities, calls, "target-198");
    expect(graph.nodes).toHaveLength(PROJECT_INDEX_GRAPH_NODE_LIMIT);
    expect(graph.nodes.some((node) => node.entity.id === "target-198")).toBe(true);
    expect(graph.edges.length).toBeLessThanOrEqual(72);
    expect(graph.omittedEntities).toBe(entities.length - PROJECT_INDEX_GRAPH_NODE_LIMIT);
    expect(graph.relationshipsOmitted).toBe(true);
  });

  it("draws only resolved file imports and keeps the map stable when a node is selected", () => {
    const source = { ...entity("source"), kind: "file" as const, filePath: "src/entry.ts" };
    const target = { ...entity("target"), kind: "file" as const, filePath: "src/helper.ts" };
    const imported = {
      id: "import",
      filePath: source.filePath,
      targetPath: target.filePath,
      range: source.range,
      sourceHash: source.sourceHash,
      specifier: "./helper",
      importText: "import './helper'",
      resolution: "workspace" as const,
      provenance: "compiler" as const,
      freshness: "current" as const,
      evidenceIds: [],
    };
    const graph = layoutProjectIndexGraph([source, target], [], null, [
      imported,
      { ...imported, id: "duplicate" },
      { ...imported, id: "unknown", resolution: "unresolved" },
    ]);
    expect(graph.edges).toEqual([
      { id: "imports:source:target", kind: "imports", sourceId: source.id, targetId: target.id },
    ]);
    expect(layoutProjectIndexGraph([source, target], [], target.id, [imported]).nodes).toEqual(
      graph.nodes,
    );
    for (const node of graph.nodes) {
      expect(node.x).toBeGreaterThan(0);
      expect(node.y).toBeGreaterThan(0);
      expect(node.x).toBeLessThan(graph.width);
      expect(node.y).toBeLessThan(graph.height);
    }
  });
});
