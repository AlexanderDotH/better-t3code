import {
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE,
  KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphEvidenceId,
  type KnowledgeGraphEvidenceV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphSemanticCandidateV1,
  type KnowledgeGraphSemanticEnqueueNodeV1,
} from "@t3tools/contracts";

const KNOWLEDGE_GRAPH_MAX_CANDIDATE_POOL_PER_SIGNAL = 48;
const KNOWLEDGE_GRAPH_MAX_DIRECT_CANDIDATE_POOL = 96;

export interface KnowledgeGraphSemanticCandidateInput {
  readonly changedNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
  readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
  readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
  readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
}

interface CandidateSignal {
  readonly direct: boolean;
  readonly sameDirectory: boolean;
  readonly sharedEvidence: boolean;
  readonly sharedLabelToken: boolean;
}

function directory(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function labelTokens(label: string): ReadonlySet<string> {
  return new Set(
    label
      .toLocaleLowerCase("en-US")
      .split(/[^a-z0-9]+/u)
      .filter((token) => token.length >= 3),
  );
}

function intersects<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function candidateScore(signal: CandidateSignal): number {
  const score =
    (signal.direct ? 0.6 : 0) +
    (signal.sharedEvidence ? 0.2 : 0) +
    (signal.sameDirectory ? 0.25 : 0) +
    (signal.sharedLabelToken ? 0.15 : 0);
  return Math.min(1, score);
}

function pairKey(left: KnowledgeGraphNodeId, right: KnowledgeGraphNodeId): string {
  return left < right ? `${left}\u0000${right}` : `${right}\u0000${left}`;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function appendIndexValue<K, V>(index: Map<K, Array<V>>, key: K, value: V): void {
  const values = index.get(key) ?? [];
  values.push(value);
  index.set(key, values);
}

function addBoundedCandidates(
  pool: Set<KnowledgeGraphNodeId>,
  candidates: ReadonlyArray<KnowledgeGraphNodeId> | undefined,
  limit: number,
): void {
  if (candidates === undefined) return;
  let added = 0;
  for (const candidate of candidates) {
    if (pool.has(candidate)) continue;
    pool.add(candidate);
    added += 1;
    if (added >= limit) return;
  }
}

function knownEvidenceIds(
  ids: ReadonlyArray<KnowledgeGraphEvidenceId>,
  known: ReadonlySet<KnowledgeGraphEvidenceId>,
): ReadonlyArray<KnowledgeGraphEvidenceId> {
  return [...new Set(ids.filter((evidenceId) => known.has(evidenceId)))]
    .sort()
    .slice(0, KNOWLEDGE_GRAPH_MAX_SEMANTIC_EVIDENCE_PER_CANDIDATE);
}

export function buildKnowledgeGraphSemanticEnqueueNodes(
  input: KnowledgeGraphSemanticCandidateInput,
): ReadonlyArray<KnowledgeGraphSemanticEnqueueNodeV1> {
  const nodeById = new Map(input.nodes.map((node) => [node.nodeId, node]));
  const evidenceIds = new Set(input.evidence.map(({ evidenceId }) => evidenceId));
  const directEvidenceByPair = new Map<string, Array<KnowledgeGraphEvidenceId>>();
  const directCandidatesByNode = new Map<KnowledgeGraphNodeId, Array<KnowledgeGraphNodeId>>();
  const candidatesByDirectory = new Map<string, Array<KnowledgeGraphNodeId>>();
  const candidatesByEvidence = new Map<KnowledgeGraphEvidenceId, Array<KnowledgeGraphNodeId>>();
  const candidatesByLabelToken = new Map<string, Array<KnowledgeGraphNodeId>>();
  const labelTokensByNode = new Map<KnowledgeGraphNodeId, ReadonlySet<string>>();
  for (const node of input.nodes) {
    const nodeDirectory = directory(node.source?.path);
    if (nodeDirectory !== undefined) {
      appendIndexValue(candidatesByDirectory, nodeDirectory, node.nodeId);
    }
    for (const evidenceId of node.evidenceIds) {
      if (evidenceIds.has(evidenceId)) {
        appendIndexValue(candidatesByEvidence, evidenceId, node.nodeId);
      }
    }
    const tokens = labelTokens(node.label);
    labelTokensByNode.set(node.nodeId, tokens);
    for (const token of tokens) appendIndexValue(candidatesByLabelToken, token, node.nodeId);
  }
  for (const edge of input.edges) {
    const key = pairKey(edge.sourceNodeId, edge.targetNodeId);
    const current = directEvidenceByPair.get(key) ?? [];
    current.push(...edge.evidenceIds);
    directEvidenceByPair.set(key, current);
    appendIndexValue(directCandidatesByNode, edge.sourceNodeId, edge.targetNodeId);
    appendIndexValue(directCandidatesByNode, edge.targetNodeId, edge.sourceNodeId);
  }
  const sortedIndexes: ReadonlyArray<Map<unknown, Array<KnowledgeGraphNodeId>>> = [
    directCandidatesByNode,
    candidatesByDirectory,
    candidatesByEvidence,
    candidatesByLabelToken,
  ];
  for (const index of sortedIndexes) {
    for (const values of index.values()) values.sort(compareStrings);
  }

  const changed = [...new Set(input.changedNodeIds)].sort();
  const enqueueNodes: Array<KnowledgeGraphSemanticEnqueueNodeV1> = [];
  for (const sourceNodeId of changed) {
    const source = nodeById.get(sourceNodeId);
    if (source === undefined) continue;
    const sourceEvidence = new Set(source.evidenceIds);
    const sourceTokens = labelTokensByNode.get(source.nodeId) ?? new Set<string>();
    const sourceDirectory = directory(source.source?.path);
    const candidates: Array<KnowledgeGraphSemanticCandidateV1> = [];
    const candidatePool = new Set<KnowledgeGraphNodeId>();
    addBoundedCandidates(
      candidatePool,
      directCandidatesByNode.get(source.nodeId),
      KNOWLEDGE_GRAPH_MAX_DIRECT_CANDIDATE_POOL,
    );
    if (sourceDirectory !== undefined) {
      addBoundedCandidates(
        candidatePool,
        candidatesByDirectory.get(sourceDirectory),
        KNOWLEDGE_GRAPH_MAX_CANDIDATE_POOL_PER_SIGNAL,
      );
    }
    const evidenceCandidates = new Set<KnowledgeGraphNodeId>();
    for (const evidenceId of [...sourceEvidence].sort(compareStrings)) {
      addBoundedCandidates(
        evidenceCandidates,
        candidatesByEvidence.get(evidenceId),
        KNOWLEDGE_GRAPH_MAX_CANDIDATE_POOL_PER_SIGNAL,
      );
      if (evidenceCandidates.size >= KNOWLEDGE_GRAPH_MAX_CANDIDATE_POOL_PER_SIGNAL) break;
    }
    for (const candidate of evidenceCandidates) candidatePool.add(candidate);
    const labelCandidates = new Set<KnowledgeGraphNodeId>();
    for (const token of [...sourceTokens].sort(compareStrings)) {
      addBoundedCandidates(
        labelCandidates,
        candidatesByLabelToken.get(token),
        KNOWLEDGE_GRAPH_MAX_CANDIDATE_POOL_PER_SIGNAL,
      );
      if (labelCandidates.size >= KNOWLEDGE_GRAPH_MAX_CANDIDATE_POOL_PER_SIGNAL) break;
    }
    for (const candidate of labelCandidates) candidatePool.add(candidate);

    for (const targetNodeId of candidatePool) {
      if (targetNodeId === source.nodeId) continue;
      const target = nodeById.get(targetNodeId);
      if (target === undefined) continue;
      const key = pairKey(source.nodeId, target.nodeId);
      const edgeEvidence = directEvidenceByPair.get(key) ?? [];
      const targetEvidence = new Set(target.evidenceIds);
      const targetDirectory = directory(target.source?.path);
      const signal: CandidateSignal = {
        direct: directEvidenceByPair.has(key),
        sameDirectory:
          sourceDirectory !== undefined &&
          targetDirectory !== undefined &&
          sourceDirectory === targetDirectory,
        sharedEvidence: intersects(sourceEvidence, targetEvidence),
        sharedLabelToken: intersects(sourceTokens, labelTokens(target.label)),
      };
      const score = candidateScore(signal);
      if (score === 0) continue;
      candidates.push({
        sourceNodeId: source.nodeId,
        candidateNodeId: target.nodeId,
        evidenceIds: knownEvidenceIds(
          [...source.evidenceIds, ...target.evidenceIds, ...edgeEvidence],
          evidenceIds,
        ),
        score,
      });
    }

    candidates.sort(
      (left, right) =>
        right.score - left.score || compareStrings(left.candidateNodeId, right.candidateNodeId),
    );
    enqueueNodes.push({
      nodeId: source.nodeId,
      nodeRevision: source.nodeRevision,
      candidates: candidates.slice(0, KNOWLEDGE_GRAPH_MAX_SEMANTIC_CANDIDATES),
    });
  }
  return enqueueNodes;
}
