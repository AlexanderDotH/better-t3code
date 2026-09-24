import type { ProjectCallsiteV1, ProjectEntityV1, ProjectImportV1 } from "@t3tools/contracts";
import { deriveProjectIndexGraph } from "@t3tools/client-runtime/project-indexing";

export const PROJECT_INDEX_GRAPH_NODE_LIMIT = 64;
const PROJECT_INDEX_GRAPH_CALL_LIMIT = 72;
const GRAPH_PADDING = 56;
const CLUSTER_MIN_RADIUS = 64;
const NODE_SPACING = 30;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

export function layoutProjectIndexGraph(
  entities: ReadonlyArray<ProjectEntityV1>,
  callsites: ReadonlyArray<ProjectCallsiteV1>,
  selectedEntityId: string | null,
  imports: ReadonlyArray<ProjectImportV1> = [],
) {
  const selectedIsVisible = entities
    .slice(0, PROJECT_INDEX_GRAPH_NODE_LIMIT)
    .some((entity) => entity.id === selectedEntityId);
  const bounded = deriveProjectIndexGraph(
    { entities, callsites, truncated: false },
    {
      maxEntities: PROJECT_INDEX_GRAPH_NODE_LIMIT,
      maxCallsites: PROJECT_INDEX_GRAPH_CALL_LIMIT,
      ...(!selectedIsVisible && selectedEntityId ? { selectedEntityId } : {}),
    },
  );
  const files = new Map<string, ProjectEntityV1[]>();
  for (const entity of bounded.entities) {
    const group = files.get(entity.filePath) ?? [];
    group.push(entity);
    files.set(entity.filePath, group);
  }
  const groups = [...files].sort(([left], [right]) => left.localeCompare(right));
  const radius = Math.max(
    CLUSTER_MIN_RADIUS,
    NODE_SPACING * Math.sqrt(Math.max(1, ...groups.map(([, entities]) => entities.length))),
  );
  const tileWidth = radius * 2 + GRAPH_PADDING * 2;
  const tileHeight = radius * 2 + GRAPH_PADDING;
  const columns = Math.max(1, Math.ceil(Math.sqrt(groups.length)));
  const clusters = groups.map(([filePath, members], index) => ({
    filePath,
    members,
    x: GRAPH_PADDING + tileWidth / 2 + (index % columns) * tileWidth,
    y: GRAPH_PADDING + tileHeight / 2 + Math.floor(index / columns) * tileHeight,
    radius,
  }));
  const width = Math.max(960, GRAPH_PADDING * 2 + columns * tileWidth);
  const height = Math.max(
    640,
    GRAPH_PADDING * 2 + Math.max(1, Math.ceil(groups.length / columns)) * tileHeight,
  );
  const offsetX = (width - (GRAPH_PADDING * 2 + columns * tileWidth)) / 2;
  const offsetY =
    (height - (GRAPH_PADDING * 2 + Math.max(1, Math.ceil(groups.length / columns)) * tileHeight)) /
    2;
  for (const cluster of clusters) {
    cluster.x += offsetX;
    cluster.y += offsetY;
  }
  const nodes = clusters.flatMap((cluster) =>
    cluster.members.map((entity, index) => {
      const orbit = index === 0 ? 0 : NODE_SPACING * Math.sqrt(index);
      const angle = index * GOLDEN_ANGLE;
      return {
        entity,
        x: cluster.x + Math.cos(angle) * orbit,
        y: cluster.y + Math.sin(angle) * orbit,
      };
    }),
  );
  const byId = new Map(nodes.map((node) => [node.entity.id, node]));
  const edges: Array<{
    id: string;
    sourceId: string;
    targetId: string;
    kind: "contains" | "resolved" | "candidate" | "imports";
  }> = [];
  for (const node of nodes) {
    const containerId = node.entity.containerId;
    if (containerId && byId.has(containerId)) {
      edges.push({
        id: `contains:${node.entity.id}`,
        sourceId: containerId,
        targetId: node.entity.id,
        kind: "contains",
      });
    }
  }
  const callEdges = new Set<string>();
  for (const callsite of bounded.callsites) {
    if (!callsite.callerEntityId || !byId.has(callsite.callerEntityId)) continue;
    if (callsite.resolution === "unresolved") continue;
    for (const targetId of callsite.targetEntityIds) {
      if (!byId.has(targetId)) continue;
      const connection = JSON.stringify([callsite.callerEntityId, targetId, callsite.resolution]);
      if (callEdges.has(connection)) continue;
      callEdges.add(connection);
      edges.push({
        id: `${callsite.id}:${targetId}`,
        sourceId: callsite.callerEntityId,
        targetId,
        kind: callsite.resolution,
      });
    }
  }
  const fileEntities = new Map(
    nodes
      .filter(({ entity }) => entity.kind === "file")
      .map(({ entity }) => [entity.filePath, entity.id]),
  );
  let importsOmitted = imports.length > PROJECT_INDEX_GRAPH_CALL_LIMIT;
  for (const imported of imports.slice(0, PROJECT_INDEX_GRAPH_CALL_LIMIT)) {
    if (edges.length >= PROJECT_INDEX_GRAPH_CALL_LIMIT * 2) {
      importsOmitted = true;
      break;
    }
    if (imported.resolution !== "workspace" || !imported.targetPath) continue;
    const sourceId = fileEntities.get(imported.filePath);
    const targetId = fileEntities.get(imported.targetPath);
    if (!sourceId || !targetId || sourceId === targetId) continue;
    const id = `imports:${sourceId}:${targetId}`;
    if (callEdges.has(id)) continue;
    callEdges.add(id);
    edges.push({ id, sourceId, targetId, kind: "imports" });
  }
  return {
    nodes,
    edges,
    byId,
    clusters,
    width,
    height,
    omittedEntities: bounded.omittedEntities,
    relationshipsOmitted:
      bounded.omittedCallsites > 0 || bounded.omittedTargets > 0 || importsOmitted,
  };
}
