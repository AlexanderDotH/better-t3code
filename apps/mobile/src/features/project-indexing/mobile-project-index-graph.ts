import { deriveProjectIndexGraph } from "@t3tools/client-runtime/project-indexing";
import {
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  KnowledgeGraphEdgeId,
  KnowledgeGraphNodeId,
  KnowledgeGraphScopeId,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphNodeV1,
  type ProjectIndexQueryResultV1,
} from "@t3tools/contracts";
import {
  resolveMobileProjectIndexEntity,
  type MobileProjectIndexEntityAnchor,
} from "./mobile-project-index-detail";

// Canvas IDs are local presentation keys; durable entity IDs stay in these maps.
const CANVAS_SCOPE_ID = KnowledgeGraphScopeId.make("project-index-view");

export function mobileProjectIndexGraphView(
  result: ProjectIndexQueryResultV1,
  selectedEntityId?: string,
  retainedAnchor: MobileProjectIndexEntityAnchor | null = null,
) {
  const selected = selectedEntityId
    ? resolveMobileProjectIndexEntity(result, selectedEntityId, retainedAnchor)
    : null;
  const staticEntities = result.entities.filter((entity) => entity.provenance !== "llm");
  const entities =
    selected &&
    selected.provenance !== "llm" &&
    !staticEntities.some((entity) => entity.id === selected.id)
      ? [selected, ...staticEntities]
      : staticEntities;
  const callsites = result.callsites.filter(
    (callsite) => callsite.provenance !== "llm" && callsite.resolution === "resolved",
  );
  const projection = deriveProjectIndexGraph(
    { ...result, entities, callsites },
    { selectedEntityId },
  );
  const entityNodeIds = new Map(
    projection.entities.map((entity, index) => [
      entity.id,
      KnowledgeGraphNodeId.make(`project-index-entity-${index}`),
    ]),
  );
  const nodeEntityIds = new Map([...entityNodeIds].map(([entityId, nodeId]) => [nodeId, entityId]));
  const nodes: KnowledgeGraphNodeV1[] = projection.entities.map((entity) => ({
    version: 1,
    nodeId: entityNodeIds.get(entity.id)!,
    scopeId: CANVAS_SCOPE_ID,
    kind: entity.kind === "file" ? "file" : "symbol",
    label: entity.name,
    ...(entity.signature ? { summary: entity.signature } : {}),
    source: {
      path: entity.filePath,
      startLine: entity.range.startLine,
      endLine: entity.range.endLine,
      symbol: entity.qualifiedName,
    },
    language: entity.language,
    provenance: "deterministic",
    confidence: 1,
    evidenceIds: [],
    nodeRevision: result.revision,
  }));
  const edges: KnowledgeGraphEdgeV1[] = [];
  const edgePatterns = new Map<KnowledgeGraphEdgeId, string>();
  let omittedEdges = 0;
  const appendEdge = (
    sourceNodeId: KnowledgeGraphNodeId,
    targetNodeId: KnowledgeGraphNodeId,
    kind: "declares" | "uses",
    confidence: number,
  ) => {
    if (edges.length >= KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES) {
      omittedEdges += 1;
      return;
    }
    const edgeId = KnowledgeGraphEdgeId.make(`project-index-edge-${edges.length}`);
    if (kind === "declares") edgePatterns.set(edgeId, "2 4");
    edges.push({
      version: 1,
      edgeId,
      scopeId: CANVAS_SCOPE_ID,
      sourceNodeId,
      targetNodeId,
      kind,
      provenance: "deterministic",
      confidence,
      evidenceIds: [],
      edgeRevision: result.revision,
    });
  };

  for (const entity of projection.entities) {
    const parent = entity.containerId ? entityNodeIds.get(entity.containerId) : undefined;
    const child = entityNodeIds.get(entity.id);
    if (parent && child) appendEdge(parent, child, "declares", 1);
  }
  for (const callsite of projection.callsites) {
    const caller = callsite.callerEntityId ? entityNodeIds.get(callsite.callerEntityId) : undefined;
    if (!caller) continue;
    for (const targetEntityId of callsite.targetEntityIds) {
      const target = entityNodeIds.get(targetEntityId);
      if (target) {
        appendEdge(caller, target, "uses", 1);
      }
    }
  }

  return {
    view: { nodes, edges, edgePatterns, matchingNodeCount: entities.length },
    entityNodeIds,
    nodeEntityIds,
    truncated: projection.truncated || omittedEdges > 0,
    omittedEntities: projection.omittedEntities,
    omittedCallsites: projection.omittedCallsites,
    omittedEdges,
  };
}
