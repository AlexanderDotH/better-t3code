// @effect-diagnostics nodeBuiltinImport:off
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type { RocksDatabase } from "@harperfast/rocksdb-js";
import {
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  type KnowledgeGraphDeterministicPatchV1,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphEdgeId,
  type KnowledgeGraphEdgeKind,
  type KnowledgeGraphEvidenceV1,
  type KnowledgeGraphEvidenceId,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphPatchV1,
  type KnowledgeGraphQueryBatchInput,
  type KnowledgeGraphQueryOperationResultV1,
  type KnowledgeGraphQueryResultV1,
  type KnowledgeGraphScopeId,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphStatusV1,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { ServerConfig } from "../../config.ts";
import { openKnowledgeKvDatabase } from "../../knowledge/KvKeys.ts";
import {
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryError,
  type KnowledgeGraphRepositoryCommit,
  type KnowledgeGraphRepositoryShape,
} from "./KnowledgeGraphRepository.ts";
import {
  readAdjacentGraphEdges,
  readEnvironmentScopes,
  readGraphEdge,
  readGraphEdges,
  readGraphEvidence,
  readGraphEvidenceSet,
  readGraphFingerprint,
  readGraphFingerprints,
  readGraphNode,
  readGraphNodes,
  readGraphPatches,
  readGraphScope,
  readSortedGraphNodes,
  removeGraphEdge,
  removeGraphEvidence,
  removeGraphFingerprint,
  removeGraphNode,
  removeGraphScopeData,
  removeOldGraphPatches,
  writeGraphEdge,
  writeGraphEvidence,
  writeGraphFingerprint,
  writeGraphNode,
  writeGraphPatch,
  writeGraphScope,
  type GraphKvDatabase,
  type GraphScopeState,
} from "./KnowledgeGraphKvData.ts";

const MAX_REPLAY_PATCHES = 256;
const OVERVIEW_NODE_LIMIT = 48;
const OVERVIEW_EDGE_LIMIT = 120;
const isRepositoryError = Schema.is(KnowledgeGraphRepositoryError);

function repositoryError(operation: string, cause: unknown): KnowledgeGraphRepositoryError {
  return isRepositoryError(cause)
    ? cause
    : new KnowledgeGraphRepositoryError({ operation, reason: "query-failed", cause });
}

function run<A>(operation: string, task: () => Promise<A>) {
  return Effect.tryPromise({ try: task, catch: (cause) => repositoryError(operation, cause) });
}

function defaultTruncation() {
  return {
    eligibleFiles: false,
    nodes: false,
    visibleNodes: false,
    omittedFileCount: 0,
    omittedNodeCount: 0,
  } as const;
}

function defaultStatus(scopeId: KnowledgeGraphScopeId): KnowledgeGraphStatusV1 {
  return {
    version: 1,
    scopeId,
    state: "idle",
    revision: 0,
    indexedFileCount: 0,
    nodeCount: 0,
    edgeCount: 0,
    evidenceCount: 0,
    semanticQueueDepth: 0,
    truncated: defaultTruncation(),
  };
}

function staticStatus(status: KnowledgeGraphStatusV1): KnowledgeGraphStatusV1 {
  const { progress, errorMessage, retryAt, ...rest } = status;
  const wasSemantic = status.state === "semantic" || status.state === "rate-limited";
  return {
    ...rest,
    state: wasSemantic ? "ready" : status.state,
    semanticQueueDepth: 0,
    ...(!wasSemantic && errorMessage !== undefined ? { errorMessage } : {}),
    ...(!wasSemantic && retryAt !== undefined ? { retryAt } : {}),
    ...(!wasSemantic && progress !== undefined && progress.phase !== "semantic"
      ? { progress: { ...progress, queuedSemanticNodeCount: 0 } }
      : {}),
  };
}

function graphScopeState(scope: KnowledgeGraphScopeV1, updatedAt: string): GraphScopeState {
  return { scope, status: defaultStatus(scope.scopeId), updatedAt };
}

function nodeOrder(left: KnowledgeGraphNodeV1, right: KnowledgeGraphNodeV1) {
  return (
    left.kind.localeCompare(right.kind) ||
    left.label.localeCompare(right.label) ||
    left.nodeId.localeCompare(right.nodeId)
  );
}

function edgeOrder(left: KnowledgeGraphEdgeV1, right: KnowledgeGraphEdgeV1) {
  return (
    left.kind.localeCompare(right.kind) ||
    left.sourceNodeId.localeCompare(right.sourceNodeId) ||
    left.targetNodeId.localeCompare(right.targetNodeId) ||
    left.edgeId.localeCompare(right.edgeId)
  );
}

async function evidenceForEntities(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  nodes: ReadonlyArray<KnowledgeGraphNodeV1>,
  edges: ReadonlyArray<KnowledgeGraphEdgeV1>,
) {
  const ids = [...new Set([...nodes, ...edges].flatMap((entity) => entity.evidenceIds))];
  const evidence: KnowledgeGraphEvidenceV1[] = [];
  for (const id of ids.slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE)) {
    const item = await readGraphEvidence(database, scopeId, id);
    if (item?.kind !== "semantic") evidence.push(...(item === undefined ? [] : [item]));
  }
  evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return { evidence, truncated: ids.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE };
}

async function readNodesByIds(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  ids: ReadonlyArray<KnowledgeGraphNodeId>,
) {
  const nodes: KnowledgeGraphNodeV1[] = [];
  for (const id of [...new Set(ids)].slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES)) {
    const node = await readGraphNode(database, scopeId, id);
    if (node?.provenance === "deterministic") nodes.push(node);
  }
  return nodes;
}

async function readVisibleEntities(database: GraphKvDatabase, scopeId: KnowledgeGraphScopeId) {
  const nodes = await readSortedGraphNodes(database, scopeId, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES);
  const visibleIds = new Set(nodes.map((node) => node.nodeId));
  const edgesById = new Map<KnowledgeGraphEdgeId, KnowledgeGraphEdgeV1>();
  for (const node of nodes) {
    for (const edge of await readAdjacentGraphEdges(database, scopeId, node.nodeId, "outgoing")) {
      if (visibleIds.has(edge.targetNodeId)) edgesById.set(edge.edgeId, edge);
    }
  }
  const edges = [...edgesById.values()].sort(edgeOrder).slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES);
  const ids = [...new Set([...nodes, ...edges].flatMap((entity) => entity.evidenceIds))].slice(
    0,
    KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  );
  const evidence: KnowledgeGraphEvidenceV1[] = [];
  for (const id of ids) {
    const item = await readGraphEvidence(database, scopeId, id);
    if (item?.kind !== "semantic") evidence.push(...(item === undefined ? [] : [item]));
  }
  evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
  return { nodes, edges, evidence };
}

async function readTraversalEdges(
  database: GraphKvDatabase,
  input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly frontierNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
    readonly direction: "incoming" | "outgoing" | "both";
    readonly kinds?: ReadonlyArray<KnowledgeGraphEdgeKind>;
    readonly excludedEdgeIds: ReadonlySet<string>;
    readonly limit: number;
  },
) {
  const found = new Map<KnowledgeGraphEdgeId, KnowledgeGraphEdgeV1>();
  for (const nodeId of new Set(input.frontierNodeIds)) {
    for (const edge of await readAdjacentGraphEdges(
      database,
      input.scopeId,
      nodeId,
      input.direction,
    )) {
      if (input.excludedEdgeIds.has(edge.edgeId)) continue;
      if (input.kinds?.length && !input.kinds.includes(edge.kind)) continue;
      if (
        !(await readGraphNode(database, input.scopeId, edge.sourceNodeId)) ||
        !(await readGraphNode(database, input.scopeId, edge.targetNodeId))
      )
        continue;
      found.set(edge.edgeId, edge);
    }
  }
  const ordered = [...found.values()].sort(edgeOrder);
  return { edges: ordered.slice(0, input.limit), truncated: ordered.length > input.limit };
}

async function queryNeighbors(
  database: GraphKvDatabase,
  input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly nodeId: KnowledgeGraphNodeId;
    readonly direction: "incoming" | "outgoing" | "both";
    readonly depth: number;
    readonly kinds?: ReadonlyArray<KnowledgeGraphEdgeKind>;
    readonly limit: number;
  },
) {
  const visited = new Set<KnowledgeGraphNodeId>([input.nodeId]);
  const edges: KnowledgeGraphEdgeV1[] = [];
  const edgeIds = new Set<string>();
  let frontier: ReadonlyArray<KnowledgeGraphNodeId> = [input.nodeId];
  let truncated = false;
  for (let depth = 0; depth < input.depth && frontier.length > 0; depth++) {
    const budget = KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES - edges.length;
    if (budget === 0) {
      truncated = true;
      break;
    }
    const batch = await readTraversalEdges(database, {
      scopeId: input.scopeId,
      frontierNodeIds: frontier,
      direction: input.direction,
      ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
      excludedEdgeIds: edgeIds,
      limit: budget,
    });
    truncated ||= batch.truncated;
    const current = new Set(frontier);
    const next = new Set<KnowledgeGraphNodeId>();
    for (const edge of batch.edges) {
      const neighbors = new Set<KnowledgeGraphNodeId>();
      if (input.direction !== "incoming" && current.has(edge.sourceNodeId))
        neighbors.add(edge.targetNodeId);
      if (input.direction !== "outgoing" && current.has(edge.targetNodeId))
        neighbors.add(edge.sourceNodeId);
      if (neighbors.size === 0) continue;
      let fits = true;
      for (const nodeId of neighbors) {
        if (visited.has(nodeId)) continue;
        if (visited.size >= input.limit) {
          truncated = true;
          fits = false;
          break;
        }
        visited.add(nodeId);
        next.add(nodeId);
      }
      if (!fits) continue;
      edges.push(edge);
      edgeIds.add(edge.edgeId);
    }
    frontier = [...next];
  }
  const nodes = await readNodesByIds(database, input.scopeId, [...visited]);
  const evidence = await evidenceForEntities(database, input.scopeId, nodes, edges);
  return { nodes, edges, evidence: evidence.evidence, truncated: truncated || evidence.truncated };
}

async function queryPath(
  database: GraphKvDatabase,
  input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly sourceNodeId: KnowledgeGraphNodeId;
    readonly targetNodeId: KnowledgeGraphNodeId;
    readonly maxDepth: number;
  },
) {
  if (input.sourceNodeId === input.targetNodeId) {
    const nodes = await readNodesByIds(database, input.scopeId, [input.sourceNodeId]);
    const evidence = await evidenceForEntities(database, input.scopeId, nodes, []);
    return { nodes, edges: [] as KnowledgeGraphEdgeV1[], ...evidence };
  }
  const visited = new Set<KnowledgeGraphNodeId>([input.sourceNodeId]);
  const explored = new Set<string>();
  const predecessor = new Map<KnowledgeGraphNodeId, KnowledgeGraphEdgeV1>();
  let frontier: ReadonlyArray<KnowledgeGraphNodeId> = [input.sourceNodeId];
  let found = false;
  let truncated = false;
  for (let depth = 0; depth < input.maxDepth && frontier.length > 0; depth++) {
    const budget = KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES - explored.size;
    if (budget === 0) {
      truncated = true;
      break;
    }
    const batch = await readTraversalEdges(database, {
      scopeId: input.scopeId,
      frontierNodeIds: frontier,
      direction: "outgoing",
      excludedEdgeIds: explored,
      limit: budget,
    });
    truncated ||= batch.truncated;
    const next = new Set<KnowledgeGraphNodeId>();
    for (const edge of batch.edges) {
      explored.add(edge.edgeId);
      if (visited.has(edge.targetNodeId)) continue;
      if (visited.size >= KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES) {
        truncated = true;
        continue;
      }
      visited.add(edge.targetNodeId);
      predecessor.set(edge.targetNodeId, edge);
      next.add(edge.targetNodeId);
      if (edge.targetNodeId === input.targetNodeId) {
        found = true;
        break;
      }
    }
    if (found) break;
    frontier = [...next];
  }
  if (!found)
    return {
      nodes: [] as KnowledgeGraphNodeV1[],
      edges: [] as KnowledgeGraphEdgeV1[],
      evidence: [] as KnowledgeGraphEvidenceV1[],
      truncated,
    };
  const edges: KnowledgeGraphEdgeV1[] = [];
  let nodeId = input.targetNodeId;
  while (nodeId !== input.sourceNodeId) {
    const edge = predecessor.get(nodeId);
    if (!edge) break;
    edges.push(edge);
    nodeId = edge.sourceNodeId;
  }
  edges.reverse();
  const nodes = await readNodesByIds(database, input.scopeId, [
    input.sourceNodeId,
    ...edges.map((edge) => edge.targetNodeId),
  ]);
  const evidence = await evidenceForEntities(database, input.scopeId, nodes, edges);
  return { nodes, edges, evidence: evidence.evidence, truncated: truncated || evidence.truncated };
}

const overviewQuotas = new Map<KnowledgeGraphNodeV1["kind"], number>([
  ["repository", 1],
  ["architecture", 1],
  ["package", 10],
  ["directory", 10],
  ["file", 12],
  ["dependency", 6],
  ["technology", 4],
  ["documentation", 4],
]);
const overviewKindOrder = [...overviewQuotas.keys()];
const overviewEdgeOrder: ReadonlyArray<KnowledgeGraphEdgeKind> = [
  "contains",
  "configures",
  "documents",
  "depends-on",
  "uses",
  "imports",
  "implements",
  "extends",
  "relates-to",
  "co-changes-with",
  "declares",
];

async function readOverview(database: GraphKvDatabase, scopeId: KnowledgeGraphScopeId) {
  const allNodes = (await readGraphNodes(database, scopeId)).filter(
    (node) => node.provenance === "deterministic",
  );
  const allEdges = (await readGraphEdges(database, scopeId)).filter(
    (edge) => edge.provenance === "deterministic",
  );
  const degree = new Map<KnowledgeGraphNodeId, number>();
  for (const edge of allEdges) {
    if (edge.kind === "declares") continue;
    degree.set(edge.sourceNodeId, (degree.get(edge.sourceNodeId) ?? 0) + 1);
    degree.set(edge.targetNodeId, (degree.get(edge.targetNodeId) ?? 0) + 1);
  }
  const selected: KnowledgeGraphNodeV1[] = [];
  for (const [kind, quota] of overviewQuotas) {
    selected.push(
      ...allNodes
        .filter((node) => node.kind === kind)
        .sort(
          (left, right) =>
            (degree.get(right.nodeId) ?? 0) - (degree.get(left.nodeId) ?? 0) ||
            left.label.localeCompare(right.label) ||
            left.nodeId.localeCompare(right.nodeId),
        )
        .slice(0, quota),
    );
  }
  const nodes = selected
    .sort(
      (left, right) =>
        overviewKindOrder.indexOf(left.kind) - overviewKindOrder.indexOf(right.kind) ||
        (degree.get(right.nodeId) ?? 0) - (degree.get(left.nodeId) ?? 0) ||
        left.label.localeCompare(right.label) ||
        left.nodeId.localeCompare(right.nodeId),
    )
    .slice(0, OVERVIEW_NODE_LIMIT);
  const nodeIds = new Set(nodes.map((node) => node.nodeId));
  const matchingEdges = allEdges.filter(
    (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
  );
  const edges = matchingEdges
    .sort(
      (left, right) =>
        overviewEdgeOrder.indexOf(left.kind) - overviewEdgeOrder.indexOf(right.kind) ||
        left.sourceNodeId.localeCompare(right.sourceNodeId) ||
        left.targetNodeId.localeCompare(right.targetNodeId) ||
        left.edgeId.localeCompare(right.edgeId),
    )
    .slice(0, OVERVIEW_EDGE_LIMIT);
  const evidence = await evidenceForEntities(database, scopeId, nodes, edges);
  return { nodes, edges, evidence: evidence.evidence, truncated: true };
}

function countAfterPatch<Id extends string>(
  previousCount: number,
  prior: ReadonlyMap<Id, boolean>,
  upserted: ReadonlySet<Id>,
  removed: ReadonlySet<Id>,
) {
  let count = previousCount;
  for (const [id, existed] of prior) {
    const exists = upserted.has(id) || (!removed.has(id) && existed);
    count += Number(exists) - Number(existed);
  }
  return count;
}

function makeRepository(database: RocksDatabase): KnowledgeGraphRepositoryShape {
  const ensureScope = (scope: KnowledgeGraphScopeV1) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      return yield* run("ensure-scope", async () => {
        await database.transaction(async (transaction) => {
          const previous = await readGraphScope(transaction, scope.scopeId);
          await writeGraphScope(
            transaction,
            previous ? { ...previous, scope, updatedAt: now } : graphScopeState(scope, now),
          );
        });
        return scope;
      });
    });

  const getStatus = (scopeId: KnowledgeGraphScopeId) =>
    run("get-status", async () => {
      const state = await readGraphScope(database, scopeId);
      return state
        ? Option.some(staticStatus(state.status))
        : Option.none<KnowledgeGraphStatusV1>();
    });

  const getSnapshot = (scopeId: KnowledgeGraphScopeId) =>
    run("get-snapshot", async () => {
      const state = await readGraphScope(database, scopeId);
      if (!state) return Option.none<KnowledgeGraphSnapshotV1>();
      const entities = await readVisibleEntities(database, scopeId);
      return Option.some({
        version: 1 as const,
        type: "snapshot" as const,
        scope: state.scope,
        revision: state.status.revision,
        ...entities,
        status: staticStatus(state.status),
        generatedAt: state.updatedAt,
      });
    });

  const getFileFingerprints = (scopeId: KnowledgeGraphScopeId) =>
    run("get-file-fingerprints", () => readGraphFingerprints(database, scopeId));

  const hasLegacySemanticData = (_scopeId: KnowledgeGraphScopeId) => Effect.succeed(false);

  const listScopes = (environmentId: KnowledgeGraphScopeV1["environmentId"]) =>
    run("list-scopes", () => readEnvironmentScopes(database, environmentId));

  const updateStatus = (status: KnowledgeGraphStatusV1) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* run("update-status", async () => {
        await database.transaction(async (transaction) => {
          const state = await readGraphScope(transaction, status.scopeId);
          if (!state)
            throw new KnowledgeGraphRepositoryError({
              operation: "update-status",
              reason: "scope-not-found",
            });
          await writeGraphScope(transaction, {
            ...state,
            status: { ...staticStatus(status), revision: state.status.revision },
            updatedAt: now,
          });
        });
      });
    });

  const getNodeBundle = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly nodeId: KnowledgeGraphNodeId;
  }) =>
    run("get-node-bundle", async () => {
      const node = await readGraphNode(database, input.scopeId, input.nodeId);
      if (node?.provenance !== "deterministic")
        return Option.none<{
          readonly node: KnowledgeGraphNodeV1;
          readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
        }>();
      const evidence: KnowledgeGraphEvidenceV1[] = [];
      for (const id of node.evidenceIds) {
        const item = await readGraphEvidence(database, input.scopeId, id);
        if (item && item.kind !== "semantic") evidence.push(item);
      }
      evidence.sort((left, right) => left.evidenceId.localeCompare(right.evidenceId));
      return Option.some({ node, evidence });
    });

  const getDeterministicState = (scopeId: KnowledgeGraphScopeId) =>
    run("get-deterministic-state", async () => {
      const state = await readGraphScope(database, scopeId);
      if (!state)
        return Option.none<{
          readonly scope: KnowledgeGraphScopeV1;
          readonly revision: number;
          readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
          readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
          readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
          readonly fileFingerprints: Awaited<ReturnType<typeof readGraphFingerprints>>;
          readonly truncation: KnowledgeGraphStatusV1["truncated"];
          readonly hasLegacySemanticData: boolean;
        }>();
      const [nodes, edges, evidence, fileFingerprints] = await Promise.all([
        readGraphNodes(database, scopeId),
        readGraphEdges(database, scopeId),
        readGraphEvidenceSet(database, scopeId),
        readGraphFingerprints(database, scopeId),
      ]);
      return Option.some({
        scope: state.scope,
        revision: state.status.revision,
        nodes: nodes.filter((node) => node.provenance === "deterministic"),
        edges: edges.filter((edge) => edge.provenance === "deterministic"),
        evidence: evidence.filter((item) => item.kind !== "semantic"),
        fileFingerprints,
        truncation: state.status.truncated,
        hasLegacySemanticData: false,
      });
    });

  const applyDeterministicPatch = (patch: KnowledgeGraphDeterministicPatchV1) =>
    run("apply-deterministic-patch", async () => {
      const commit = await database.transaction(async (transaction) => {
        const previous =
          (await readGraphScope(transaction, patch.scope.scopeId)) ??
          graphScopeState(patch.scope, patch.committedAt);
        if (previous.status.revision !== patch.baseRevision) {
          throw new KnowledgeGraphRepositoryError({
            operation: "apply-deterministic-patch",
            reason: "revision-conflict",
          });
        }
        const scopeId = patch.scope.scopeId;
        const upsertedNodes = new Set(patch.nodes.map((node) => node.nodeId));
        const upsertedEdges = new Set(patch.edges.map((edge) => edge.edgeId));
        const upsertedEvidence = new Set(patch.evidence.map((item) => item.evidenceId));
        const upsertedFingerprints = new Set(patch.fileFingerprints.map((item) => item.path));
        const removedNodes = new Set(patch.removals.nodeIds);
        const removedEdges = new Set(patch.removals.edgeIds);
        const removedEvidence = new Set(patch.removals.evidenceIds);
        const removedFingerprints = new Set(patch.removals.fingerprintPaths);
        for (const nodeId of removedNodes) {
          for (const edge of await readAdjacentGraphEdges(transaction, scopeId, nodeId, "both"))
            removedEdges.add(edge.edgeId);
        }
        const priorNodes = new Map<KnowledgeGraphNodeId, boolean>();
        const priorEdges = new Map<KnowledgeGraphEdgeId, boolean>();
        const priorEvidence = new Map<KnowledgeGraphEvidenceId, boolean>();
        const priorFingerprints = new Map<string, boolean>();
        for (const id of new Set([...removedNodes, ...upsertedNodes]))
          priorNodes.set(id, (await readGraphNode(transaction, scopeId, id)) !== undefined);
        for (const id of new Set([...removedEdges, ...upsertedEdges]))
          priorEdges.set(id, (await readGraphEdge(transaction, scopeId, id)) !== undefined);
        for (const id of new Set([...removedEvidence, ...upsertedEvidence]))
          priorEvidence.set(id, (await readGraphEvidence(transaction, scopeId, id)) !== undefined);
        for (const path of new Set([...removedFingerprints, ...upsertedFingerprints]))
          priorFingerprints.set(
            path,
            (await readGraphFingerprint(transaction, scopeId, path)) !== undefined,
          );

        for (const id of removedEdges) await removeGraphEdge(transaction, scopeId, id);
        for (const id of removedNodes) await removeGraphNode(transaction, scopeId, id);
        for (const id of removedEvidence) await removeGraphEvidence(transaction, scopeId, id);
        for (const path of removedFingerprints)
          await removeGraphFingerprint(transaction, scopeId, path);
        for (const item of patch.evidence) await writeGraphEvidence(transaction, item);
        for (const item of patch.nodes) await writeGraphNode(transaction, item);
        for (const item of patch.edges) {
          if (
            !(await readGraphNode(transaction, scopeId, item.sourceNodeId)) ||
            !(await readGraphNode(transaction, scopeId, item.targetNodeId))
          )
            throw new Error("A graph edge references a missing node.");
          await writeGraphEdge(transaction, item);
        }
        for (const item of patch.fileFingerprints)
          await writeGraphFingerprint(transaction, scopeId, item);

        const revision = patch.baseRevision + 1;
        const status: KnowledgeGraphStatusV1 = {
          version: 1,
          scopeId,
          state: "ready",
          revision,
          indexedFileCount: countAfterPatch(
            previous.status.indexedFileCount,
            priorFingerprints,
            upsertedFingerprints,
            removedFingerprints,
          ),
          nodeCount: countAfterPatch(
            previous.status.nodeCount,
            priorNodes,
            upsertedNodes,
            removedNodes,
          ),
          edgeCount: countAfterPatch(
            previous.status.edgeCount,
            priorEdges,
            upsertedEdges,
            removedEdges,
          ),
          evidenceCount: countAfterPatch(
            previous.status.evidenceCount,
            priorEvidence,
            upsertedEvidence,
            removedEvidence,
          ),
          semanticQueueDepth: 0,
          lastIndexedAt: patch.committedAt,
          truncated: patch.truncation,
        };
        const requiresSnapshot =
          patch.nodes.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES ||
          removedNodes.size > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES ||
          patch.changedNodeIds.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES ||
          patch.edges.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES ||
          removedEdges.size > KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES ||
          patch.evidence.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE ||
          removedEvidence.size > KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE;
        const visiblePatch: KnowledgeGraphPatchV1 = {
          version: 1,
          type: "patch",
          scopeId,
          baseRevision: patch.baseRevision,
          revision,
          upsertedNodes: patch.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
          removedNodeIds: [...removedNodes].slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
          upsertedEdges: patch.edges.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES),
          removedEdgeIds: [...removedEdges].slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES),
          upsertedEvidence: patch.evidence.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE),
          removedEvidenceIds: [...removedEvidence].slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE),
          changedNodeIds: patch.changedNodeIds.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
          status,
        };
        await writeGraphScope(transaction, {
          scope: patch.scope,
          status,
          updatedAt: patch.committedAt,
        });
        if (!requiresSnapshot) await writeGraphPatch(transaction, visiblePatch);
        await removeOldGraphPatches(transaction, scopeId, revision - MAX_REPLAY_PATCHES);
        const changedNodeIds = new Set(patch.changedNodeIds);
        return {
          version: 1,
          scopeId,
          baseRevision: patch.baseRevision,
          revision,
          patch: visiblePatch,
          changedNodes: patch.nodes
            .filter((node) => changedNodeIds.has(node.nodeId))
            .map((node) => ({ node, nodeRevision: node.nodeRevision, scopeRevision: revision })),
          delivery: requiresSnapshot ? "invalidate" : "patch",
        } satisfies KnowledgeGraphRepositoryCommit;
      });
      if (commit === undefined) throw new Error("The graph transaction returned no commit.");
      return commit;
    });

  const listPatchesAfter = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly afterRevision: number;
  }) =>
    run("list-patches-after", async () =>
      (
        await readGraphPatches(database, input.scopeId, input.afterRevision, MAX_REPLAY_PATCHES)
      ).map((patch) => ({ ...patch, status: staticStatus(patch.status) })),
    );

  const query = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly query: KnowledgeGraphQueryBatchInput;
  }) =>
    run("query", async (): Promise<KnowledgeGraphQueryResultV1> => {
      const scope = await readGraphScope(database, input.scopeId);
      if (!scope)
        throw new KnowledgeGraphRepositoryError({ operation: "query", reason: "scope-not-found" });
      const status = staticStatus(scope.status);
      const results: KnowledgeGraphQueryOperationResultV1[] = [];
      for (const operation of input.query.queries) {
        if (operation.type === "search") {
          const text = operation.text.toLocaleLowerCase("en-US");
          const nodes = (await readGraphNodes(database, input.scopeId))
            .filter((node) => node.provenance === "deterministic")
            .filter(
              (node) =>
                `${node.label}\n${node.summary ?? ""}`.toLocaleLowerCase("en-US").includes(text) &&
                (!operation.kinds?.length || operation.kinds.includes(node.kind)),
            )
            .sort(nodeOrder);
          const limit = operation.limit ?? Math.min(100, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES);
          const selected = nodes.slice(0, limit);
          const evidence = await evidenceForEntities(database, input.scopeId, selected, []);
          results.push({
            id: operation.id,
            type: operation.type,
            nodes: selected,
            edges: [],
            evidence: evidence.evidence,
            truncated:
              nodes.length > limit ||
              evidence.truncated ||
              status.truncated.eligibleFiles ||
              status.truncated.nodes,
          });
        } else if (operation.type === "node") {
          const node = await readGraphNode(database, input.scopeId, operation.nodeId);
          const visible = node?.provenance === "deterministic" ? [node] : [];
          const evidence = await evidenceForEntities(database, input.scopeId, visible, []);
          results.push({
            id: operation.id,
            type: operation.type,
            nodes: visible,
            edges: [],
            evidence: evidence.evidence,
            truncated: evidence.truncated,
          });
        } else if (operation.type === "neighbors") {
          const result = await queryNeighbors(database, {
            scopeId: input.scopeId,
            nodeId: operation.nodeId,
            direction: operation.direction ?? "both",
            depth: operation.depth,
            ...(operation.kinds === undefined ? {} : { kinds: operation.kinds }),
            limit: operation.limit ?? KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
          });
          results.push({ id: operation.id, type: operation.type, ...result });
        } else if (operation.type === "path") {
          const result = await queryPath(database, {
            scopeId: input.scopeId,
            sourceNodeId: operation.sourceNodeId,
            targetNodeId: operation.targetNodeId,
            maxDepth: operation.maxDepth ?? 8,
          });
          results.push({ id: operation.id, type: operation.type, ...result });
        } else if (status.nodeCount > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES) {
          const overview = await readOverview(database, input.scopeId);
          results.push({
            id: operation.id,
            type: operation.type,
            ...overview,
            truncated:
              overview.truncated ||
              status.truncated.eligibleFiles ||
              status.truncated.nodes ||
              status.truncated.visibleNodes,
          });
        } else {
          const snapshot = await readVisibleEntities(database, input.scopeId);
          const nodes = snapshot.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES);
          const nodeIds = new Set(nodes.map((node) => node.nodeId));
          const matchingEdges = snapshot.edges.filter(
            (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
          );
          const edges = matchingEdges.slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES);
          const evidence = await evidenceForEntities(database, input.scopeId, nodes, edges);
          results.push({
            id: operation.id,
            type: operation.type,
            nodes,
            edges,
            evidence: evidence.evidence,
            truncated:
              snapshot.nodes.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES ||
              matchingEdges.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES ||
              evidence.truncated ||
              status.truncated.eligibleFiles ||
              status.truncated.nodes ||
              status.truncated.visibleNodes,
          });
        }
      }
      return { version: 1, scope: scope.scope, revision: scope.status.revision, results };
    });

  const clearScope = (scopeId: KnowledgeGraphScopeId) =>
    run("clear-scope", async () => {
      await database.transaction((transaction) => removeGraphScopeData(transaction, scopeId));
    });

  const clearEnvironment = (environmentId: KnowledgeGraphScopeV1["environmentId"]) =>
    run("clear-environment", async () => {
      const scopes = await readEnvironmentScopes(database, environmentId);
      for (const scope of scopes)
        await database.transaction((transaction) =>
          removeGraphScopeData(transaction, scope.scopeId),
        );
    });

  return {
    ensureScope,
    getSnapshot,
    getStatus,
    getFileFingerprints,
    hasLegacySemanticData,
    listScopes,
    updateStatus,
    getNodeBundle,
    getDeterministicState,
    applyDeterministicPatch,
    listPatchesAfter,
    query,
    clearScope,
    clearEnvironment,
  } satisfies KnowledgeGraphRepositoryShape;
}

export function knowledgeGraphKvLayerAt(directory: string) {
  return Layer.effect(
    KnowledgeGraphRepository,
    Effect.acquireRelease(
      run("open-graph-store", async () => {
        await NodeFSP.mkdir(NodePath.dirname(directory), { recursive: true });
        return openKnowledgeKvDatabase(directory);
      }),
      (database) => Effect.sync(() => database.close()),
    ).pipe(Effect.map((database) => KnowledgeGraphRepository.of(makeRepository(database)))),
  );
}

export const KnowledgeGraphRepositoryKvLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    return knowledgeGraphKvLayerAt(NodePath.join(config.stateDir, "knowledge-graph.rocksdb"));
  }),
);
