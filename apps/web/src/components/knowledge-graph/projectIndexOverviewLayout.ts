import type {
  ProjectEntityV1,
  ProjectIndexGraphOverviewV1,
  ProjectIndexQueryResultV1,
} from "@t3tools/contracts";

export const PROJECT_MAP_ROOT = "\0project-root";
export const PROJECT_MAP_NODE_LIMIT = 192;
const MAX_EDGES = 512;
const WIDTH = 960;
const HEIGHT = 640;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export interface ProjectMapNode {
  readonly id: string;
  readonly parentId: string | null;
  readonly name: string;
  readonly qualifiedName: string;
  readonly filePath: string;
  readonly kind: ProjectEntityV1["kind"] | "directory";
  readonly freshness: ProjectEntityV1["freshness"] | null;
  readonly fileCount: number | null;
  readonly line: number | null;
  readonly entityId: string | null;
  readonly expandable: boolean;
  readonly expanded: boolean;
}

export interface ProjectMapEdge {
  readonly id: string;
  readonly sourceId: string;
  readonly targetId: string;
  readonly kind: "contains" | "imports" | "resolved";
}

/** Keep containment separate from imports/calls: a folder link is not a code dependency. */
export function buildProjectIndexMap(
  overview: ProjectIndexGraphOverviewV1,
  branches: ReadonlyMap<string, ProjectIndexQueryResultV1>,
  expandedSymbols: ReadonlySet<string>,
) {
  const nodes: ProjectMapNode[] = [];
  const added = new Set<string>();
  const edges: ProjectMapEdge[] = [];
  let truncated = overview.truncated;
  const add = (node: ProjectMapNode) => {
    if (added.has(node.id)) return false;
    if (nodes.length >= PROJECT_MAP_NODE_LIMIT) {
      truncated = true;
      return false;
    }
    nodes.push(node);
    added.add(node.id);
    if (node.parentId !== null)
      edges.push({
        id: `contains:${node.id}`,
        sourceId: node.parentId,
        targetId: node.id,
        kind: "contains",
      });
    return true;
  };
  const appendSymbols = (path: string, result: ProjectIndexQueryResultV1) => {
    const entities = result.entities.filter(
      (entity) => entity.filePath === path && entity.kind !== "file" && entity.provenance !== "llm",
    );
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const children = new Map<string, ProjectEntityV1[]>();
    for (const entity of entities) {
      const parentId =
        entity.containerId && byId.has(entity.containerId) ? entity.containerId : path;
      const group = children.get(parentId) ?? [];
      group.push(entity);
      children.set(parentId, group);
    }
    const seen = new Set<string>();
    const append = (parentId: string) => {
      for (const entity of children.get(parentId) ?? []) {
        if (seen.has(entity.id)) continue;
        seen.add(entity.id);
        const expanded = expandedSymbols.has(entity.id);
        if (
          !add({
            id: entity.id,
            parentId,
            name: entity.name,
            qualifiedName: entity.qualifiedName,
            filePath: path,
            kind: entity.kind,
            freshness: entity.freshness,
            fileCount: null,
            line: entity.range.startLine,
            entityId: entity.id,
            expandable: children.has(entity.id),
            expanded,
          })
        )
          break;
        if (expanded) append(entity.id);
      }
    };
    append(path);
    for (const call of result.callsites) {
      if (call.resolution !== "resolved" || !call.callerEntityId) continue;
      for (const targetId of call.targetEntityIds)
        edges.push({
          id: `call:${call.callerEntityId}:${targetId}`,
          sourceId: call.callerEntityId,
          targetId,
          kind: "resolved",
        });
    }
    truncated ||= result.truncated || result.nextCursor !== null;
  };
  const appendDirectory = (graph: ProjectIndexGraphOverviewV1, parentId: string) => {
    truncated ||= graph.truncated;
    const expanded: Array<{
      node: ProjectIndexGraphOverviewV1["nodes"][number];
      branch: ProjectIndexQueryResultV1;
    }> = [];
    for (const item of graph.nodes) {
      const branch = branches.get(item.path);
      if (
        !add({
          id: item.path,
          parentId,
          name: item.path.split("/").at(-1) ?? item.path,
          qualifiedName: item.path,
          filePath: item.path,
          kind: item.kind,
          freshness: null,
          fileCount: item.fileCount,
          line: null,
          entityId: null,
          expandable: true,
          expanded: branch !== undefined,
        })
      )
        break;
      if (branch) expanded.push({ node: item, branch });
    }
    for (const edge of graph.edges)
      edges.push({
        id: `imports:${edge.source}:${edge.target}`,
        sourceId: edge.source,
        targetId: edge.target,
        kind: "imports",
      });
    for (const { node, branch } of expanded) {
      if (node.kind === "directory" && branch.graph) appendDirectory(branch.graph, node.path);
      else if (node.kind === "file") appendSymbols(node.path, branch);
    }
  };
  add({
    id: PROJECT_MAP_ROOT,
    parentId: null,
    name: "",
    qualifiedName: "",
    filePath: "",
    kind: "directory",
    freshness: null,
    fileCount: overview.indexedFiles,
    line: null,
    entityId: null,
    expandable: branches.size > 0,
    expanded: branches.size > 0,
  });
  appendDirectory(overview, PROJECT_MAP_ROOT);
  const visibleIds = new Set(nodes.map((node) => node.id));
  const uniqueEdges = new Map(
    edges
      .filter((edge) => visibleIds.has(edge.sourceId) && visibleIds.has(edge.targetId))
      .map((edge) => [edge.id, edge]),
  );
  const visibleEdges = [...uniqueEdges.values()];
  return {
    nodes,
    edges: [
      ...visibleEdges.filter((edge) => edge.kind === "contains"),
      ...visibleEdges.filter((edge) => edge.kind !== "contains"),
    ].slice(0, MAX_EDGES),
    truncated: truncated || visibleEdges.length > MAX_EDGES,
  };
}

export type ProjectIndexMap = ReturnType<typeof buildProjectIndexMap>;

/** Settle only when a branch changes; nodes make space for the newly revealed children. */
export function layoutProjectIndexOverview(graph: ProjectIndexMap) {
  const positions = new Map<string, { x: number; y: number }>();
  const siblingCounts = new Map<string | null, number>();
  const nodes = graph.nodes.map((node) => {
    const parent = positions.get(node.parentId ?? "") ?? { x: WIDTH / 2, y: HEIGHT / 2 };
    const index = siblingCounts.get(node.parentId) ?? 0;
    siblingCounts.set(node.parentId, index + 1);
    const radius = node.parentId === null ? 0 : 170 + 26 * Math.sqrt(index);
    const position = {
      x: parent.x + Math.cos(index * GOLDEN_ANGLE) * radius,
      y: parent.y + Math.sin(index * GOLDEN_ANGLE) * radius,
    };
    positions.set(node.id, position);
    return { ...node, ...position };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const indexes = new Map(nodes.map((node, index) => [node.id, index]));
  for (let iteration = 0; iteration < 140; iteration++) {
    const forces = nodes.map(() => ({ x: 0, y: 0 }));
    for (let left = 0; left < nodes.length; left++) {
      for (let right = left + 1; right < nodes.length; right++) {
        const a = nodes[left]!;
        const b = nodes[right]!;
        const dx = (a.x - b.x) / 1.6;
        const dy = a.y - b.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const repulsion = Math.min(20, 12_000 / (distance * distance));
        const x = (dx / distance) * repulsion;
        const y = (dy / distance) * repulsion;
        forces[left]!.x += x;
        forces[left]!.y += y;
        forces[right]!.x -= x;
        forces[right]!.y -= y;
      }
    }
    for (const edge of graph.edges) {
      const source = byId.get(edge.sourceId)!;
      const target = byId.get(edge.targetId)!;
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const attraction = (distance - 170) * (edge.kind === "contains" ? 0.018 : 0.003);
      const x = (dx / distance) * attraction;
      const y = (dy / distance) * attraction;
      const sourceForce = forces[indexes.get(source.id)!]!;
      const targetForce = forces[indexes.get(target.id)!]!;
      sourceForce.x += x;
      sourceForce.y += y;
      targetForce.x -= x;
      targetForce.y -= y;
    }
    nodes.forEach((node, index) => {
      if (node.parentId === null) return;
      const anchor = positions.get(node.id)!;
      node.x += forces[index]!.x + (anchor.x - node.x) * 0.004;
      node.y += forces[index]!.y + (anchor.y - node.y) * 0.004;
    });
  }
  return {
    nodes,
    byId,
    edges: graph.edges,
    clusters: [],
    width: WIDTH,
    height: HEIGHT,
    omittedEntities: 0,
    relationshipsOmitted: graph.truncated,
  };
}
