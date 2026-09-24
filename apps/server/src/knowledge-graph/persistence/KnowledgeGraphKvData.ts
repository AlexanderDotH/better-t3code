import type { RocksDatabase, Transaction } from "@harperfast/rocksdb-js";
import {
  KnowledgeGraphEdgeV1,
  KnowledgeGraphEvidenceV1,
  KnowledgeGraphFileFingerprintV1,
  KnowledgeGraphNodeV1,
  KnowledgeGraphPatchV1,
  KnowledgeGraphScopeV1,
  KnowledgeGraphStatusV1,
  type KnowledgeGraphEdgeId,
  type KnowledgeGraphEvidenceId,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphScopeId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { kvKey, scanKvPrefix } from "../../knowledge/KvKeys.ts";

export type GraphKvDatabase = RocksDatabase | Transaction;

export const GraphScopeState = Schema.Struct({
  scope: KnowledgeGraphScopeV1,
  status: KnowledgeGraphStatusV1,
  updatedAt: Schema.String,
});
export type GraphScopeState = typeof GraphScopeState.Type;

const decodeScope = Schema.decodeUnknownSync(GraphScopeState);
const decodeNode = Schema.decodeUnknownSync(KnowledgeGraphNodeV1);
const decodeEdge = Schema.decodeUnknownSync(KnowledgeGraphEdgeV1);
const decodeEvidence = Schema.decodeUnknownSync(KnowledgeGraphEvidenceV1);
const decodeFingerprint = Schema.decodeUnknownSync(KnowledgeGraphFileFingerprintV1);
const decodePatch = Schema.decodeUnknownSync(KnowledgeGraphPatchV1);

const scopeKey = (scopeId: KnowledgeGraphScopeId) => kvKey("graph", "scope", scopeId);
const nodeKey = (scopeId: KnowledgeGraphScopeId, nodeId: KnowledgeGraphNodeId) =>
  kvKey("graph", "node", scopeId, nodeId);
const edgeKey = (scopeId: KnowledgeGraphScopeId, edgeId: KnowledgeGraphEdgeId) =>
  kvKey("graph", "edge", scopeId, edgeId);
const evidenceKey = (scopeId: KnowledgeGraphScopeId, evidenceId: KnowledgeGraphEvidenceId) =>
  kvKey("graph", "evidence", scopeId, evidenceId);
const fingerprintKey = (scopeId: KnowledgeGraphScopeId, path: string) =>
  kvKey("graph", "fingerprint", scopeId, path);
const nodeSortKey = (node: KnowledgeGraphNodeV1) =>
  kvKey(
    "graph",
    "node-sort",
    node.scopeId,
    node.kind,
    Buffer.from(node.label).toString("hex"),
    node.nodeId,
  );
const sourceEdgeKey = (edge: KnowledgeGraphEdgeV1) =>
  kvKey("graph", "edge-source", edge.scopeId, edge.sourceNodeId, edge.edgeId);
const targetEdgeKey = (edge: KnowledgeGraphEdgeV1) =>
  kvKey("graph", "edge-target", edge.scopeId, edge.targetNodeId, edge.edgeId);
const environmentScopeKey = (scope: KnowledgeGraphScopeV1) =>
  kvKey("graph", "environment", scope.environmentId, scope.scopeId);
const patchKey = (scopeId: KnowledgeGraphScopeId, revision: number) =>
  kvKey("graph", "patch", scopeId, revision.toString().padStart(12, "0"));

export async function readGraphScope(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
): Promise<GraphScopeState | undefined> {
  const value = await database.get(scopeKey(scopeId));
  return value === undefined ? undefined : decodeScope(value);
}

export async function writeGraphScope(transaction: Transaction, state: GraphScopeState) {
  const previous = await readGraphScope(transaction, state.scope.scopeId);
  if (previous?.scope.environmentId !== state.scope.environmentId) {
    if (previous) await transaction.remove(environmentScopeKey(previous.scope));
    await transaction.put(environmentScopeKey(state.scope), state.scope.scopeId);
  }
  await transaction.put(scopeKey(state.scope.scopeId), state);
}

export async function readGraphNode(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  nodeId: KnowledgeGraphNodeId,
): Promise<KnowledgeGraphNodeV1 | undefined> {
  const value = await database.get(nodeKey(scopeId, nodeId));
  return value === undefined ? undefined : decodeNode(value);
}

export async function writeGraphNode(transaction: Transaction, node: KnowledgeGraphNodeV1) {
  const previous = await readGraphNode(transaction, node.scopeId, node.nodeId);
  if (previous) await transaction.remove(nodeSortKey(previous));
  await transaction.put(nodeKey(node.scopeId, node.nodeId), node);
  await transaction.put(nodeSortKey(node), node.nodeId);
}

export async function removeGraphNode(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
  nodeId: KnowledgeGraphNodeId,
) {
  const previous = await readGraphNode(transaction, scopeId, nodeId);
  if (!previous) return false;
  await transaction.remove(nodeKey(scopeId, nodeId));
  await transaction.remove(nodeSortKey(previous));
  return true;
}

export async function readGraphEdge(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  edgeId: KnowledgeGraphEdgeId,
): Promise<KnowledgeGraphEdgeV1 | undefined> {
  const value = await database.get(edgeKey(scopeId, edgeId));
  return value === undefined ? undefined : decodeEdge(value);
}

export async function writeGraphEdge(transaction: Transaction, edge: KnowledgeGraphEdgeV1) {
  const previous = await readGraphEdge(transaction, edge.scopeId, edge.edgeId);
  if (previous) {
    await transaction.remove(sourceEdgeKey(previous));
    await transaction.remove(targetEdgeKey(previous));
  }
  await transaction.put(edgeKey(edge.scopeId, edge.edgeId), edge);
  await transaction.put(sourceEdgeKey(edge), edge.edgeId);
  await transaction.put(targetEdgeKey(edge), edge.edgeId);
}

export async function removeGraphEdge(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
  edgeId: KnowledgeGraphEdgeId,
) {
  const previous = await readGraphEdge(transaction, scopeId, edgeId);
  if (!previous) return false;
  await transaction.remove(edgeKey(scopeId, edgeId));
  await transaction.remove(sourceEdgeKey(previous));
  await transaction.remove(targetEdgeKey(previous));
  return true;
}

export async function readGraphEvidence(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  evidenceId: KnowledgeGraphEvidenceId,
): Promise<KnowledgeGraphEvidenceV1 | undefined> {
  const value = await database.get(evidenceKey(scopeId, evidenceId));
  return value === undefined ? undefined : decodeEvidence(value);
}

export async function writeGraphEvidence(
  transaction: Transaction,
  evidence: KnowledgeGraphEvidenceV1,
) {
  await transaction.put(evidenceKey(evidence.scopeId, evidence.evidenceId), evidence);
}

export async function removeGraphEvidence(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
  evidenceId: KnowledgeGraphEvidenceId,
) {
  if ((await transaction.get(evidenceKey(scopeId, evidenceId))) === undefined) return false;
  await transaction.remove(evidenceKey(scopeId, evidenceId));
  return true;
}

export async function readGraphFingerprint(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  path: string,
): Promise<KnowledgeGraphFileFingerprintV1 | undefined> {
  const value = await database.get(fingerprintKey(scopeId, path));
  return value === undefined ? undefined : decodeFingerprint(value);
}

export async function writeGraphFingerprint(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
  fingerprint: KnowledgeGraphFileFingerprintV1,
) {
  await transaction.put(fingerprintKey(scopeId, fingerprint.path), fingerprint);
}

export async function removeGraphFingerprint(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
  path: string,
) {
  if ((await transaction.get(fingerprintKey(scopeId, path))) === undefined) return false;
  await transaction.remove(fingerprintKey(scopeId, path));
  return true;
}

export async function readGraphNodes(database: GraphKvDatabase, scopeId: KnowledgeGraphScopeId) {
  const nodes: KnowledgeGraphNodeV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "node", scopeId))
    nodes.push(decodeNode(value));
  return nodes;
}

export async function readSortedGraphNodes(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  limit: number,
) {
  const nodes: KnowledgeGraphNodeV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "node-sort", scopeId)) {
    const node = await readGraphNode(database, scopeId, String(value) as KnowledgeGraphNodeId);
    if (node?.provenance === "deterministic") nodes.push(node);
    if (nodes.length >= limit) break;
  }
  return nodes;
}

export async function readGraphEdges(database: GraphKvDatabase, scopeId: KnowledgeGraphScopeId) {
  const edges: KnowledgeGraphEdgeV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "edge", scopeId))
    edges.push(decodeEdge(value));
  return edges;
}

export async function readAdjacentGraphEdges(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  nodeId: KnowledgeGraphNodeId,
  direction: "incoming" | "outgoing" | "both",
) {
  const ids = new Set<KnowledgeGraphEdgeId>();
  for (const index of direction === "both"
    ? ["edge-source", "edge-target"]
    : [direction === "incoming" ? "edge-target" : "edge-source"]) {
    for await (const { value } of scanKvPrefix(database, "graph", index, scopeId, nodeId))
      ids.add(String(value) as KnowledgeGraphEdgeId);
  }
  const edges: KnowledgeGraphEdgeV1[] = [];
  for (const id of ids) {
    const edge = await readGraphEdge(database, scopeId, id);
    if (edge?.provenance === "deterministic") edges.push(edge);
  }
  return edges;
}

export async function readGraphEvidenceSet(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
) {
  const evidence: KnowledgeGraphEvidenceV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "evidence", scopeId))
    evidence.push(decodeEvidence(value));
  return evidence;
}

export async function readGraphFingerprints(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
) {
  const fingerprints: KnowledgeGraphFileFingerprintV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "fingerprint", scopeId))
    fingerprints.push(decodeFingerprint(value));
  return fingerprints;
}

export async function readEnvironmentScopes(
  database: GraphKvDatabase,
  environmentId: KnowledgeGraphScopeV1["environmentId"],
) {
  const scopes: KnowledgeGraphScopeV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "environment", environmentId)) {
    const state = await readGraphScope(database, String(value) as KnowledgeGraphScopeId);
    if (state) scopes.push(state.scope);
  }
  return scopes.sort(
    (left, right) =>
      left.effectiveWorkspaceRoot.localeCompare(right.effectiveWorkspaceRoot) ||
      left.projectId.localeCompare(right.projectId) ||
      left.scopeId.localeCompare(right.scopeId),
  );
}

export async function writeGraphPatch(transaction: Transaction, patch: KnowledgeGraphPatchV1) {
  await transaction.put(patchKey(patch.scopeId, patch.revision), patch);
}

export async function readGraphPatches(
  database: GraphKvDatabase,
  scopeId: KnowledgeGraphScopeId,
  afterRevision: number,
  limit: number,
) {
  const patches: KnowledgeGraphPatchV1[] = [];
  for await (const { value } of scanKvPrefix(database, "graph", "patch", scopeId)) {
    const patch = decodePatch(value);
    if (patch.revision > afterRevision) patches.push(patch);
    if (patches.length >= limit) break;
  }
  return patches;
}

export async function removeOldGraphPatches(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
  lastRemovedRevision: number,
) {
  for await (const { key, value } of scanKvPrefix(transaction, "graph", "patch", scopeId)) {
    if (decodePatch(value).revision > lastRemovedRevision) break;
    await transaction.remove(key);
  }
}

export async function removeGraphScopeData(
  transaction: Transaction,
  scopeId: KnowledgeGraphScopeId,
) {
  const state = await readGraphScope(transaction, scopeId);
  if (state) await transaction.remove(environmentScopeKey(state.scope));
  await transaction.remove(scopeKey(scopeId));
  for (const collection of [
    "node",
    "node-sort",
    "edge",
    "edge-source",
    "edge-target",
    "evidence",
    "fingerprint",
    "patch",
  ]) {
    const keys: string[] = [];
    for await (const { key } of scanKvPrefix(transaction, "graph", collection, scopeId))
      keys.push(key);
    for (const key of keys) await transaction.remove(key);
  }
}
