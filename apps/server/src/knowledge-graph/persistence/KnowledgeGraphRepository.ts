import {
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES,
  KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
  KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES,
  type KnowledgeGraphCommittedPatchV1,
  type KnowledgeGraphDeterministicPatchV1,
  type KnowledgeGraphEdgeV1,
  type KnowledgeGraphEdgeKind,
  KnowledgeGraphEdgeId,
  KnowledgeGraphEdgeV1 as KnowledgeGraphEdgeSchema,
  type KnowledgeGraphEvidenceV1,
  KnowledgeGraphEvidenceV1 as KnowledgeGraphEvidenceSchema,
  type KnowledgeGraphFileFingerprintV1,
  KnowledgeGraphFileFingerprintV1 as KnowledgeGraphFileFingerprintSchema,
  type KnowledgeGraphNodeV1,
  type KnowledgeGraphNodeId,
  type KnowledgeGraphModelGeneration,
  KnowledgeGraphNodeV1 as KnowledgeGraphNodeSchema,
  type KnowledgeGraphPatchV1,
  KnowledgeGraphPatchV1 as KnowledgeGraphPatchSchema,
  KnowledgeGraphProgressV1 as KnowledgeGraphProgressSchema,
  type KnowledgeGraphQueryBatchInput,
  type KnowledgeGraphQueryOperationResultV1,
  type KnowledgeGraphQueryResultV1,
  type KnowledgeGraphScopeId,
  type KnowledgeGraphScopeV1,
  type KnowledgeGraphSemanticPatchV1,
  type KnowledgeGraphSnapshotV1,
  type KnowledgeGraphStatusV1,
  KnowledgeGraphStatusV1 as KnowledgeGraphStatusSchema,
  type KnowledgeGraphTruncationV1,
  KnowledgeGraphTruncationV1 as KnowledgeGraphTruncationSchema,
  type KnowledgeGraphEvidenceId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export const KnowledgeGraphRepositoryErrorReason = Schema.Literals([
  "query-failed",
  "decode-failed",
  "revision-conflict",
  "scope-not-found",
]);
export type KnowledgeGraphRepositoryErrorReason = typeof KnowledgeGraphRepositoryErrorReason.Type;

export class KnowledgeGraphRepositoryError extends Schema.TaggedErrorClass<KnowledgeGraphRepositoryError>()(
  "KnowledgeGraphRepositoryError",
  {
    operation: Schema.String,
    reason: KnowledgeGraphRepositoryErrorReason,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return `Knowledge Graph persistence failed in ${this.operation} (${this.reason}).`;
  }
}

export interface KnowledgeGraphRepositoryShape {
  readonly ensureScope: (
    scope: KnowledgeGraphScopeV1,
  ) => Effect.Effect<KnowledgeGraphScopeV1, KnowledgeGraphRepositoryError>;
  readonly getSnapshot: (
    scopeId: KnowledgeGraphScopeId,
  ) => Effect.Effect<Option.Option<KnowledgeGraphSnapshotV1>, KnowledgeGraphRepositoryError>;
  readonly getStatus: (
    scopeId: KnowledgeGraphScopeId,
  ) => Effect.Effect<Option.Option<KnowledgeGraphStatusV1>, KnowledgeGraphRepositoryError>;
  readonly getFileFingerprints: (
    scopeId: KnowledgeGraphScopeId,
  ) => Effect.Effect<ReadonlyArray<KnowledgeGraphFileFingerprintV1>, KnowledgeGraphRepositoryError>;
  readonly listScopes: (
    environmentId: KnowledgeGraphScopeV1["environmentId"],
  ) => Effect.Effect<ReadonlyArray<KnowledgeGraphScopeV1>, KnowledgeGraphRepositoryError>;
  readonly updateStatus: (
    status: KnowledgeGraphStatusV1,
  ) => Effect.Effect<void, KnowledgeGraphRepositoryError>;
  readonly reconcileSemanticModel: (input: {
    readonly environmentId: KnowledgeGraphScopeV1["environmentId"];
    readonly modelKey: string | null;
  }) => Effect.Effect<
    {
      readonly modelGeneration: KnowledgeGraphModelGeneration;
      readonly changed: boolean;
    },
    KnowledgeGraphRepositoryError
  >;
  readonly getNodeBundle: (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly nodeId: KnowledgeGraphNodeId;
  }) => Effect.Effect<
    Option.Option<{
      readonly node: KnowledgeGraphNodeV1;
      readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
    }>,
    KnowledgeGraphRepositoryError
  >;
  readonly getDeterministicState: (scopeId: KnowledgeGraphScopeId) => Effect.Effect<
    Option.Option<{
      readonly scope: KnowledgeGraphScopeV1;
      readonly revision: number;
      readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
      readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
      readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
      readonly fileFingerprints: ReadonlyArray<KnowledgeGraphFileFingerprintV1>;
      readonly truncation: KnowledgeGraphTruncationV1;
    }>,
    KnowledgeGraphRepositoryError
  >;
  readonly applyDeterministicPatch: (
    patch: KnowledgeGraphDeterministicPatchV1,
  ) => Effect.Effect<KnowledgeGraphRepositoryCommit, KnowledgeGraphRepositoryError>;
  readonly applySemanticPatch: (
    patch: KnowledgeGraphSemanticPatchV1,
  ) => Effect.Effect<KnowledgeGraphRepositoryCommit, KnowledgeGraphRepositoryError>;
  readonly listPatchesAfter: (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly afterRevision: number;
  }) => Effect.Effect<ReadonlyArray<KnowledgeGraphPatchV1>, KnowledgeGraphRepositoryError>;
  readonly query: (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly query: KnowledgeGraphQueryBatchInput;
  }) => Effect.Effect<KnowledgeGraphQueryResultV1, KnowledgeGraphRepositoryError>;
  readonly clearScope: (
    scopeId: KnowledgeGraphScopeId,
  ) => Effect.Effect<void, KnowledgeGraphRepositoryError>;
  readonly clearEnvironment: (
    environmentId: KnowledgeGraphScopeV1["environmentId"],
  ) => Effect.Effect<void, KnowledgeGraphRepositoryError>;
}

export type KnowledgeGraphRepositoryCommit = KnowledgeGraphCommittedPatchV1 & {
  readonly delivery: "patch" | "invalidate";
};

export class KnowledgeGraphRepository extends Context.Service<
  KnowledgeGraphRepository,
  KnowledgeGraphRepositoryShape
>()("t3/knowledge-graph/persistence/KnowledgeGraphRepository") {}

interface ScopeRow {
  readonly scopeId: string;
  readonly environmentId: string;
  readonly projectId: string;
  readonly effectiveWorkspaceRoot: string;
  readonly isWorktree: number;
  readonly revision: number;
  readonly statusJson: string;
  readonly truncationJson: string;
  readonly updatedAt: string;
}

interface JsonRow {
  readonly json: string;
}

interface SemanticEnvironmentRow {
  readonly semanticModelKey: string | null;
  readonly modelGeneration: number;
}

const decodeStatusJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(KnowledgeGraphStatusSchema),
);
const decodeNodeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(KnowledgeGraphNodeSchema));
const decodeEdgeJson = Schema.decodeUnknownEffect(Schema.fromJsonString(KnowledgeGraphEdgeSchema));
const decodeEvidenceJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(KnowledgeGraphEvidenceSchema),
);
const decodeFingerprintJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(KnowledgeGraphFileFingerprintSchema),
);
const decodePatchJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(KnowledgeGraphPatchSchema),
);
const decodeTruncationJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(KnowledgeGraphTruncationSchema),
);
const isKnowledgeGraphRepositoryError = Schema.is(KnowledgeGraphRepositoryError);

export const KNOWLEDGE_GRAPH_MAX_REPLAY_PATCHES = 256;

const encodeStatusJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphStatusSchema));
const encodeNodeJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphNodeSchema));
const encodeEdgeJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphEdgeSchema));
const encodeEvidenceJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphEvidenceSchema));
const encodePatchJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphPatchSchema));
const encodeProgressJson = Schema.encodeSync(Schema.fromJsonString(KnowledgeGraphProgressSchema));
const encodeTruncationJson = Schema.encodeSync(
  Schema.fromJsonString(KnowledgeGraphTruncationSchema),
);

const decodeJson = <A>(
  decoder: (input: unknown) => Effect.Effect<A, Schema.SchemaError>,
  json: string,
  operation: string,
): Effect.Effect<A, KnowledgeGraphRepositoryError> =>
  decoder(json).pipe(
    Effect.mapError(
      (cause) => new KnowledgeGraphRepositoryError({ operation, reason: "decode-failed", cause }),
    ),
  );

const mapError = (operation: string) =>
  Effect.mapError((cause: unknown) =>
    isKnowledgeGraphRepositoryError(cause)
      ? cause
      : new KnowledgeGraphRepositoryError({ operation, reason: "query-failed", cause }),
  );

const defaultTruncation = (): KnowledgeGraphTruncationV1 => ({
  eligibleFiles: false,
  nodes: false,
  visibleNodes: false,
  omittedFileCount: 0,
  omittedNodeCount: 0,
});

const defaultStatus = (scopeId: KnowledgeGraphScopeId): KnowledgeGraphStatusV1 => ({
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
});

const scopeFromRow = (row: ScopeRow): KnowledgeGraphScopeV1 =>
  ({
    version: 1,
    scopeId: row.scopeId,
    environmentId: row.environmentId,
    projectId: row.projectId,
    effectiveWorkspaceRoot: row.effectiveWorkspaceRoot,
    isWorktree: row.isWorktree === 1,
  }) as KnowledgeGraphScopeV1;

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const readScope = (scopeId: KnowledgeGraphScopeId) =>
    sql<ScopeRow>`
      SELECT
        scope_id AS "scopeId",
        environment_id AS "environmentId",
        project_id AS "projectId",
        effective_workspace_root AS "effectiveWorkspaceRoot",
        is_worktree AS "isWorktree",
        revision,
        status_json AS "statusJson",
        truncation_json AS "truncationJson",
        updated_at AS "updatedAt"
      FROM knowledge_graph_scopes
      WHERE scope_id = ${scopeId}
    `;

  const ensureScope = (scope: KnowledgeGraphScopeV1) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const status = defaultStatus(scope.scopeId);
      yield* sql`
        INSERT INTO knowledge_graph_scopes (
          scope_id,
          environment_id,
          project_id,
          effective_workspace_root,
          is_worktree,
          revision,
          state,
          status_json,
          progress_json,
          truncation_json,
          created_at,
          updated_at
        ) VALUES (
          ${scope.scopeId},
          ${scope.environmentId},
          ${scope.projectId},
          ${scope.effectiveWorkspaceRoot},
          ${scope.isWorktree ? 1 : 0},
          0,
          ${status.state},
          ${encodeStatusJson(status)},
          NULL,
          ${encodeTruncationJson(status.truncated)},
          ${now},
          ${now}
        )
        ON CONFLICT (scope_id) DO UPDATE SET
          environment_id = excluded.environment_id,
          project_id = excluded.project_id,
          effective_workspace_root = excluded.effective_workspace_root,
          is_worktree = excluded.is_worktree,
          updated_at = excluded.updated_at
      `;
      return scope;
    }).pipe(mapError("ensure-scope"));

  const getStatus = (scopeId: KnowledgeGraphScopeId) =>
    Effect.gen(function* () {
      const rows = yield* readScope(scopeId);
      const row = rows[0];
      if (row === undefined) return Option.none<KnowledgeGraphStatusV1>();
      return Option.some(yield* decodeJson(decodeStatusJson, row.statusJson, "get-status"));
    }).pipe(mapError("get-status"));

  const readEntities = (scopeId: KnowledgeGraphScopeId) =>
    Effect.gen(function* () {
      const nodeRows = yield* sql<JsonRow>`
        SELECT node_json AS json
        FROM knowledge_graph_nodes
        WHERE scope_id = ${scopeId}
        ORDER BY kind, label, node_id
        LIMIT ${KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES}
      `;
      const nodes = yield* Effect.forEach(nodeRows, ({ json }) =>
        decodeJson(decodeNodeJson, json, "decode-node"),
      );
      const visibleNodeIds = nodes.map(({ nodeId }) => nodeId);
      if (visibleNodeIds.length === 0) return { nodes, edges: [], evidence: [] };
      const placeholders = visibleNodeIds.map(() => "?").join(", ");
      const edgeRows = yield* sql.unsafe<JsonRow>(
        `SELECT edge_json AS json
         FROM knowledge_graph_edges
         WHERE scope_id = ?
           AND source_node_id IN (${placeholders})
           AND target_node_id IN (${placeholders})
         ORDER BY kind, source_node_id, target_node_id, edge_id
         LIMIT ?`,
        [scopeId, ...visibleNodeIds, ...visibleNodeIds, KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES],
      );
      const edges = yield* Effect.forEach(edgeRows, ({ json }) =>
        decodeJson(decodeEdgeJson, json, "decode-edge"),
      );
      const evidenceIds = [
        ...new Set(
          [
            ...nodes.flatMap(({ evidenceIds }) => evidenceIds),
            ...edges.flatMap(({ evidenceIds }) => evidenceIds),
          ].map(String),
        ),
      ].slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE);
      if (evidenceIds.length === 0) return { nodes, edges, evidence: [] };
      const evidenceRows = yield* sql.unsafe<JsonRow>(
        `SELECT evidence_json AS json
         FROM knowledge_graph_evidence
         WHERE scope_id = ? AND evidence_id IN (${evidenceIds.map(() => "?").join(", ")})
         ORDER BY evidence_id`,
        [scopeId, ...evidenceIds],
      );
      const evidence = yield* Effect.forEach(evidenceRows, ({ json }) =>
        decodeJson(decodeEvidenceJson, json, "decode-evidence"),
      );
      return { nodes, edges, evidence };
    });

  const readEvidenceByIds = (
    scopeId: KnowledgeGraphScopeId,
    evidenceIds: ReadonlyArray<KnowledgeGraphEvidenceId>,
  ) => {
    const boundedIds = [...new Set(evidenceIds.map(String))].slice(
      0,
      KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
    );
    if (boundedIds.length === 0) {
      return Effect.succeed<ReadonlyArray<KnowledgeGraphEvidenceV1>>([]);
    }
    return sql
      .unsafe<JsonRow>(
        `SELECT evidence_json AS json
         FROM knowledge_graph_evidence
         WHERE scope_id = ? AND evidence_id IN (${boundedIds.map(() => "?").join(", ")})
         ORDER BY evidence_id`,
        [scopeId, ...boundedIds],
      )
      .pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, ({ json }) =>
            decodeJson(decodeEvidenceJson, json, "decode-query-evidence"),
          ),
        ),
        mapError("read-query-evidence"),
      );
  };

  const searchNodes = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly text: string;
    readonly kinds?: ReadonlyArray<KnowledgeGraphNodeV1["kind"]>;
    readonly limit: number;
  }) =>
    Effect.gen(function* () {
      const escaped = input.text
        .toLocaleLowerCase("en-US")
        .replaceAll("\\", "\\\\")
        .replaceAll("%", "\\%")
        .replaceAll("_", "\\_");
      const kindFilter =
        input.kinds !== undefined && input.kinds.length > 0
          ? ` AND kind IN (${input.kinds.map(() => "?").join(", ")})`
          : "";
      const rows = yield* sql.unsafe<JsonRow>(
        `SELECT node_json AS json
         FROM knowledge_graph_nodes
         WHERE scope_id = ?
           AND lower(label || char(10) || coalesce(summary, '')) LIKE ? ESCAPE '\\'
           ${kindFilter}
         ORDER BY kind, label, node_id
         LIMIT ?`,
        [input.scopeId, `%${escaped}%`, ...(input.kinds ?? []), input.limit + 1],
      );
      const decoded = yield* Effect.forEach(rows, ({ json }) =>
        decodeJson(decodeNodeJson, json, "decode-query-search-node"),
      );
      return {
        nodes: decoded.slice(0, input.limit),
        truncated: decoded.length > input.limit,
      };
    }).pipe(mapError("search-query-nodes"));

  const readNodesByIds = (
    scopeId: KnowledgeGraphScopeId,
    nodeIds: ReadonlyArray<KnowledgeGraphNodeId>,
  ) => {
    const boundedIds = [...new Set(nodeIds.map(String))].slice(
      0,
      KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
    );
    if (boundedIds.length === 0) {
      return Effect.succeed<ReadonlyArray<KnowledgeGraphNodeV1>>([]);
    }
    return sql
      .unsafe<JsonRow>(
        `SELECT node_json AS json
         FROM knowledge_graph_nodes
         WHERE scope_id = ? AND node_id IN (${boundedIds.map(() => "?").join(", ")})`,
        [scopeId, ...boundedIds],
      )
      .pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, ({ json }) => decodeJson(decodeNodeJson, json, "decode-query-node")),
        ),
        Effect.map((nodes) => {
          const nodesById = new Map(nodes.map((node) => [String(node.nodeId), node] as const));
          return boundedIds.flatMap((nodeId) => {
            const node = nodesById.get(nodeId);
            return node === undefined ? [] : [node];
          });
        }),
        mapError("read-query-nodes"),
      );
  };

  const readTraversalEdges = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly frontierNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
    readonly direction: "incoming" | "outgoing" | "both";
    readonly kinds?: ReadonlyArray<KnowledgeGraphEdgeKind>;
    readonly excludedEdgeIds: ReadonlyArray<string>;
    readonly limit: number;
  }) => {
    const frontierNodeIds = [...new Set(input.frontierNodeIds.map(String))];
    if (frontierNodeIds.length === 0 || input.limit <= 0) {
      return Effect.succeed({ edges: [] as ReadonlyArray<KnowledgeGraphEdgeV1>, truncated: false });
    }
    const placeholders = frontierNodeIds.map(() => "?").join(", ");
    const endpointFilter =
      input.direction === "outgoing"
        ? `source_node_id IN (${placeholders})`
        : input.direction === "incoming"
          ? `target_node_id IN (${placeholders})`
          : `(source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}))`;
    const endpointParameters =
      input.direction === "both" ? [...frontierNodeIds, ...frontierNodeIds] : frontierNodeIds;
    const kindFilter =
      input.kinds !== undefined && input.kinds.length > 0
        ? ` AND kind IN (${input.kinds.map(() => "?").join(", ")})`
        : "";
    const excludedFilter =
      input.excludedEdgeIds.length > 0
        ? ` AND edge_id NOT IN (${input.excludedEdgeIds.map(() => "?").join(", ")})`
        : "";
    return sql
      .unsafe<JsonRow>(
        `SELECT edge_json AS json
         FROM knowledge_graph_edges
         WHERE scope_id = ? AND ${endpointFilter}${kindFilter}${excludedFilter}
         ORDER BY kind, source_node_id, target_node_id, edge_id
         LIMIT ?`,
        [
          input.scopeId,
          ...endpointParameters,
          ...(input.kinds ?? []),
          ...input.excludedEdgeIds,
          input.limit + 1,
        ],
      )
      .pipe(
        Effect.flatMap((rows) =>
          Effect.forEach(rows, ({ json }) =>
            decodeJson(decodeEdgeJson, json, "decode-query-traversal-edge"),
          ),
        ),
        Effect.map((edges) => ({
          edges: edges.slice(0, input.limit),
          truncated: edges.length > input.limit,
        })),
        mapError("read-query-traversal-edges"),
      );
  };

  const evidenceForEntities = Effect.fn("KnowledgeGraphRepository.evidenceForEntities")(
    function* (input: {
      readonly scopeId: KnowledgeGraphScopeId;
      readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
      readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
    }) {
      const evidenceIds = [
        ...new Set([...input.nodes, ...input.edges].flatMap(({ evidenceIds }) => evidenceIds)),
      ];
      const evidence = yield* readEvidenceByIds(input.scopeId, evidenceIds);
      return {
        evidence,
        truncated: evidenceIds.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
      };
    },
  );

  const queryNeighbors = Effect.fn("KnowledgeGraphRepository.queryNeighbors")(function* (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly nodeId: KnowledgeGraphNodeId;
    readonly direction: "incoming" | "outgoing" | "both";
    readonly depth: number;
    readonly kinds?: ReadonlyArray<KnowledgeGraphEdgeKind>;
    readonly limit: number;
  }) {
    const visitedNodeIds = new Set<KnowledgeGraphNodeId>([input.nodeId]);
    const selectedEdges: KnowledgeGraphEdgeV1[] = [];
    const selectedEdgeIds = new Set<string>();
    let frontierNodeIds: ReadonlyArray<KnowledgeGraphNodeId> = [input.nodeId];
    let truncated = false;

    for (let depth = 0; depth < input.depth && frontierNodeIds.length > 0; depth += 1) {
      const edgeBudget = KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES - selectedEdges.length;
      if (edgeBudget === 0) {
        truncated = true;
        break;
      }
      const batch = yield* readTraversalEdges({
        scopeId: input.scopeId,
        frontierNodeIds,
        direction: input.direction,
        ...(input.kinds === undefined ? {} : { kinds: input.kinds }),
        excludedEdgeIds: [...selectedEdgeIds],
        limit: edgeBudget,
      });
      truncated ||= batch.truncated;
      const frontier = new Set(frontierNodeIds);
      const nextFrontier = new Set<KnowledgeGraphNodeId>();
      for (const edge of batch.edges) {
        const adjacentNodeIds = new Set<KnowledgeGraphNodeId>();
        if (input.direction !== "incoming" && frontier.has(edge.sourceNodeId)) {
          adjacentNodeIds.add(edge.targetNodeId);
        }
        if (input.direction !== "outgoing" && frontier.has(edge.targetNodeId)) {
          adjacentNodeIds.add(edge.sourceNodeId);
        }
        if (adjacentNodeIds.size === 0) continue;
        let includeEdge = true;
        for (const nextNodeId of adjacentNodeIds) {
          if (visitedNodeIds.has(nextNodeId)) continue;
          if (visitedNodeIds.size >= input.limit) {
            truncated = true;
            includeEdge = false;
            break;
          }
          visitedNodeIds.add(nextNodeId);
          nextFrontier.add(nextNodeId);
        }
        if (!includeEdge) continue;
        selectedEdges.push(edge);
        selectedEdgeIds.add(String(edge.edgeId));
      }
      frontierNodeIds = [...nextFrontier];
    }

    const nodes = yield* readNodesByIds(input.scopeId, [...visitedNodeIds]);
    const evidence = yield* evidenceForEntities({
      scopeId: input.scopeId,
      nodes,
      edges: selectedEdges,
    });
    return {
      nodes,
      edges: selectedEdges,
      evidence: evidence.evidence,
      truncated: truncated || evidence.truncated,
    };
  });

  const queryPath = Effect.fn("KnowledgeGraphRepository.queryPath")(function* (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly sourceNodeId: KnowledgeGraphNodeId;
    readonly targetNodeId: KnowledgeGraphNodeId;
    readonly maxDepth: number;
  }) {
    if (input.sourceNodeId === input.targetNodeId) {
      const nodes = yield* readNodesByIds(input.scopeId, [input.sourceNodeId]);
      const evidence = yield* evidenceForEntities({ scopeId: input.scopeId, nodes, edges: [] });
      return {
        nodes,
        edges: [] as ReadonlyArray<KnowledgeGraphEdgeV1>,
        evidence: evidence.evidence,
        truncated: evidence.truncated,
      };
    }
    const visitedNodeIds = new Set<KnowledgeGraphNodeId>([input.sourceNodeId]);
    const exploredEdgeIds = new Set<string>();
    const predecessor = new Map<KnowledgeGraphNodeId, KnowledgeGraphEdgeV1>();
    let frontierNodeIds: ReadonlyArray<KnowledgeGraphNodeId> = [input.sourceNodeId];
    let found = false;
    let truncated = false;

    for (let depth = 0; depth < input.maxDepth && frontierNodeIds.length > 0; depth += 1) {
      const edgeBudget = KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES - exploredEdgeIds.size;
      if (edgeBudget === 0) {
        truncated = true;
        break;
      }
      const batch = yield* readTraversalEdges({
        scopeId: input.scopeId,
        frontierNodeIds,
        direction: "outgoing",
        excludedEdgeIds: [...exploredEdgeIds],
        limit: edgeBudget,
      });
      truncated ||= batch.truncated;
      const nextFrontier = new Set<KnowledgeGraphNodeId>();
      for (const edge of batch.edges) {
        exploredEdgeIds.add(String(edge.edgeId));
        if (visitedNodeIds.has(edge.targetNodeId)) continue;
        if (visitedNodeIds.size >= KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES) {
          truncated = true;
          continue;
        }
        visitedNodeIds.add(edge.targetNodeId);
        predecessor.set(edge.targetNodeId, edge);
        nextFrontier.add(edge.targetNodeId);
        if (edge.targetNodeId === input.targetNodeId) {
          found = true;
          break;
        }
      }
      if (found) break;
      frontierNodeIds = [...nextFrontier];
    }
    if (!found) {
      return {
        nodes: [] as ReadonlyArray<KnowledgeGraphNodeV1>,
        edges: [] as ReadonlyArray<KnowledgeGraphEdgeV1>,
        evidence: [],
        truncated,
      };
    }

    const pathEdges: KnowledgeGraphEdgeV1[] = [];
    let currentNodeId = input.targetNodeId;
    while (currentNodeId !== input.sourceNodeId) {
      const edge = predecessor.get(currentNodeId);
      if (edge === undefined) break;
      pathEdges.push(edge);
      currentNodeId = edge.sourceNodeId;
    }
    pathEdges.reverse();
    const pathNodeIds = [input.sourceNodeId, ...pathEdges.map(({ targetNodeId }) => targetNodeId)];
    const nodes = yield* readNodesByIds(input.scopeId, pathNodeIds);
    const evidence = yield* evidenceForEntities({
      scopeId: input.scopeId,
      nodes,
      edges: pathEdges,
    });
    return {
      nodes,
      edges: pathEdges,
      evidence: evidence.evidence,
      truncated: truncated || evidence.truncated,
    };
  });

  const getSnapshot = (scopeId: KnowledgeGraphScopeId) =>
    Effect.gen(function* () {
      const rows = yield* readScope(scopeId);
      const row = rows[0];
      if (row === undefined) return Option.none<KnowledgeGraphSnapshotV1>();
      const status = yield* decodeJson(decodeStatusJson, row.statusJson, "get-snapshot");
      const entities = yield* readEntities(scopeId);
      return Option.some({
        version: 1 as const,
        type: "snapshot" as const,
        scope: scopeFromRow(row),
        revision: row.revision,
        ...entities,
        status,
        generatedAt: row.updatedAt,
      });
    }).pipe(mapError("get-snapshot"));

  const getFileFingerprints = (scopeId: KnowledgeGraphScopeId) =>
    Effect.gen(function* () {
      const rows = yield* sql<JsonRow>`
        SELECT json_object(
          'path', path,
          'fingerprint', fingerprint,
          'sizeBytes', size_bytes,
          'modifiedAtMs', modified_at_ms,
          'extractionVersion', extraction_version,
          'seenGeneration', seen_generation
        ) AS json
        FROM knowledge_graph_file_fingerprints
        WHERE scope_id = ${scopeId}
        ORDER BY path
      `;
      return yield* Effect.forEach(rows, ({ json }) =>
        decodeJson(decodeFingerprintJson, json, "get-file-fingerprints"),
      );
    }).pipe(mapError("get-file-fingerprints"));

  const listScopes = (environmentId: KnowledgeGraphScopeV1["environmentId"]) =>
    sql<ScopeRow>`
      SELECT
        scope_id AS "scopeId",
        environment_id AS "environmentId",
        project_id AS "projectId",
        effective_workspace_root AS "effectiveWorkspaceRoot",
        is_worktree AS "isWorktree",
        revision,
        status_json AS "statusJson",
        truncation_json AS "truncationJson",
        updated_at AS "updatedAt"
      FROM knowledge_graph_scopes
      WHERE environment_id = ${environmentId}
      ORDER BY effective_workspace_root, project_id, scope_id
    `.pipe(
      Effect.map((rows) => rows.map(scopeFromRow)),
      mapError("list-scopes"),
    );

  const updateStatus = (status: KnowledgeGraphStatusV1) =>
    Effect.gen(function* () {
      const now = DateTime.formatIso(yield* DateTime.now);
      const rows = yield* readScope(status.scopeId);
      if (rows[0] === undefined) {
        return yield* new KnowledgeGraphRepositoryError({
          operation: "update-status",
          reason: "scope-not-found",
        });
      }
      yield* sql`
        UPDATE knowledge_graph_scopes SET
          state = ${status.state},
          status_json = ${encodeStatusJson(status)},
          progress_json = ${status.progress === undefined ? null : encodeProgressJson(status.progress)},
          truncation_json = ${encodeTruncationJson(status.truncated)},
          updated_at = ${now}
        WHERE scope_id = ${status.scopeId}
      `;
    }).pipe(mapError("update-status"));

  const reconcileSemanticModel = (input: {
    readonly environmentId: KnowledgeGraphScopeV1["environmentId"];
    readonly modelKey: string | null;
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          const rows = yield* sql<SemanticEnvironmentRow>`
          SELECT
            semantic_model_key AS "semanticModelKey",
            model_generation AS "modelGeneration"
          FROM knowledge_graph_semantic_environments
          WHERE environment_id = ${input.environmentId}
        `;
          const current = rows[0];
          if (current === undefined && input.modelKey === null) {
            return { modelGeneration: 0 as KnowledgeGraphModelGeneration, changed: false };
          }
          if (current?.semanticModelKey === input.modelKey) {
            return {
              modelGeneration: current.modelGeneration as KnowledgeGraphModelGeneration,
              changed: false,
            };
          }

          const modelGeneration = (current?.modelGeneration ?? 0) + 1;
          const now = yield* Clock.currentTimeMillis;
          yield* sql`
          INSERT INTO knowledge_graph_semantic_environments (
            environment_id,
            paused,
            rate_limited_until,
            semantic_model_key,
            model_generation,
            updated_at
          ) VALUES (
            ${input.environmentId},
            0,
            NULL,
            ${input.modelKey},
            ${modelGeneration},
            ${now}
          ) ON CONFLICT (environment_id) DO UPDATE SET
            paused = 0,
            rate_limited_until = NULL,
            semantic_model_key = excluded.semantic_model_key,
            model_generation = excluded.model_generation,
            updated_at = excluded.updated_at
        `;
          return {
            modelGeneration: modelGeneration as KnowledgeGraphModelGeneration,
            changed: true,
          };
        }),
      )
      .pipe(mapError("reconcile-semantic-model"));

  const getNodeBundle = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly nodeId: KnowledgeGraphNodeId;
  }) =>
    Effect.gen(function* () {
      const nodeRows = yield* sql<JsonRow>`
        SELECT node_json AS json
        FROM knowledge_graph_nodes
        WHERE scope_id = ${input.scopeId} AND node_id = ${input.nodeId}
      `;
      const nodeRow = nodeRows[0];
      if (nodeRow === undefined) {
        return Option.none<{
          readonly node: KnowledgeGraphNodeV1;
          readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
        }>();
      }
      const node = yield* decodeJson(decodeNodeJson, nodeRow.json, "get-node-bundle");
      const evidenceRows = yield* sql<JsonRow>`
        SELECT evidence.evidence_json AS json
        FROM knowledge_graph_node_evidence AS link
        JOIN knowledge_graph_evidence AS evidence
          ON evidence.scope_id = link.scope_id AND evidence.evidence_id = link.evidence_id
        WHERE link.scope_id = ${input.scopeId} AND link.node_id = ${input.nodeId}
        ORDER BY evidence.evidence_id
      `;
      const evidence = yield* Effect.forEach(evidenceRows, ({ json }) =>
        decodeJson(decodeEvidenceJson, json, "get-node-bundle-evidence"),
      );
      return Option.some({ node, evidence });
    }).pipe(mapError("get-node-bundle"));

  const getDeterministicState = (scopeId: KnowledgeGraphScopeId) =>
    Effect.gen(function* () {
      const rows = yield* readScope(scopeId);
      const row = rows[0];
      if (row === undefined) {
        return Option.none<{
          readonly scope: KnowledgeGraphScopeV1;
          readonly revision: number;
          readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
          readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
          readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
          readonly fileFingerprints: ReadonlyArray<KnowledgeGraphFileFingerprintV1>;
          readonly truncation: KnowledgeGraphTruncationV1;
        }>();
      }
      const [nodeRows, edgeRows, evidenceRows, fileFingerprints, truncation] = yield* Effect.all([
        sql<JsonRow>`
          SELECT node_json AS json FROM knowledge_graph_nodes
          WHERE scope_id = ${scopeId} AND provenance = 'deterministic'
          ORDER BY node_id
        `,
        sql<JsonRow>`
          SELECT edge_json AS json FROM knowledge_graph_edges
          WHERE scope_id = ${scopeId} AND provenance = 'deterministic'
          ORDER BY edge_id
        `,
        sql<JsonRow>`
          SELECT evidence_json AS json FROM knowledge_graph_evidence
          WHERE scope_id = ${scopeId} AND kind <> 'semantic'
          ORDER BY evidence_id
        `,
        getFileFingerprints(scopeId),
        decodeJson(decodeTruncationJson, row.truncationJson, "get-deterministic-state"),
      ]);
      const [nodes, edges, evidence] = yield* Effect.all([
        Effect.forEach(nodeRows, ({ json }) =>
          decodeJson(decodeNodeJson, json, "get-deterministic-state-node"),
        ),
        Effect.forEach(edgeRows, ({ json }) =>
          decodeJson(decodeEdgeJson, json, "get-deterministic-state-edge"),
        ),
        Effect.forEach(evidenceRows, ({ json }) =>
          decodeJson(decodeEvidenceJson, json, "get-deterministic-state-evidence"),
        ),
      ]);
      return Option.some({
        scope: scopeFromRow(row),
        revision: row.revision,
        nodes,
        edges,
        evidence,
        fileFingerprints,
        truncation,
      });
    }).pipe(mapError("get-deterministic-state"));

  const writeEvidence = (evidence: KnowledgeGraphEvidenceV1) =>
    sql`
      INSERT INTO knowledge_graph_evidence (
        scope_id, evidence_id, kind, source_path, source_start_line, source_end_line,
        source_symbol, excerpt, fingerprint, confidence, evidence_revision, evidence_json
      ) VALUES (
        ${evidence.scopeId}, ${evidence.evidenceId}, ${evidence.kind},
        ${evidence.source?.path ?? null}, ${evidence.source?.startLine ?? null},
        ${evidence.source?.endLine ?? null}, ${evidence.source?.symbol ?? null},
        ${evidence.excerpt ?? null}, ${evidence.fingerprint}, ${evidence.confidence},
        ${evidence.evidenceRevision}, ${encodeEvidenceJson(evidence)}
      ) ON CONFLICT (scope_id, evidence_id) DO UPDATE SET
        kind = excluded.kind,
        source_path = excluded.source_path,
        source_start_line = excluded.source_start_line,
        source_end_line = excluded.source_end_line,
        source_symbol = excluded.source_symbol,
        excerpt = excluded.excerpt,
        fingerprint = excluded.fingerprint,
        confidence = excluded.confidence,
        evidence_revision = excluded.evidence_revision,
        evidence_json = excluded.evidence_json
    `;

  const writeNode = (node: KnowledgeGraphNodeV1) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO knowledge_graph_nodes (
          scope_id, node_id, kind, label, source_path, source_start_line, source_end_line,
          source_symbol, summary, language, provenance, confidence, node_revision, node_json
        ) VALUES (
          ${node.scopeId}, ${node.nodeId}, ${node.kind}, ${node.label},
          ${node.source?.path ?? null}, ${node.source?.startLine ?? null},
          ${node.source?.endLine ?? null}, ${node.source?.symbol ?? null},
          ${node.summary ?? null}, ${node.language ?? null}, ${node.provenance},
          ${node.confidence}, ${node.nodeRevision}, ${encodeNodeJson(node)}
        ) ON CONFLICT (scope_id, node_id) DO UPDATE SET
          kind = excluded.kind,
          label = excluded.label,
          source_path = excluded.source_path,
          source_start_line = excluded.source_start_line,
          source_end_line = excluded.source_end_line,
          source_symbol = excluded.source_symbol,
          summary = excluded.summary,
          language = excluded.language,
          provenance = excluded.provenance,
          confidence = excluded.confidence,
          node_revision = excluded.node_revision,
          node_json = excluded.node_json
      `;
      yield* sql`
        DELETE FROM knowledge_graph_node_evidence
        WHERE scope_id = ${node.scopeId} AND node_id = ${node.nodeId}
      `;
      yield* Effect.forEach(
        node.evidenceIds,
        (evidenceId) =>
          sql`
          INSERT OR IGNORE INTO knowledge_graph_node_evidence (scope_id, node_id, evidence_id)
          VALUES (${node.scopeId}, ${node.nodeId}, ${evidenceId})
        `,
        { discard: true },
      );
    });

  const writeEdge = (edge: KnowledgeGraphEdgeV1) =>
    Effect.gen(function* () {
      yield* sql`
        INSERT INTO knowledge_graph_edges (
          scope_id, edge_id, kind, source_node_id, target_node_id, provenance,
          confidence, edge_revision, edge_json
        ) VALUES (
          ${edge.scopeId}, ${edge.edgeId}, ${edge.kind}, ${edge.sourceNodeId},
          ${edge.targetNodeId}, ${edge.provenance}, ${edge.confidence},
          ${edge.edgeRevision}, ${encodeEdgeJson(edge)}
        ) ON CONFLICT (scope_id, edge_id) DO UPDATE SET
          kind = excluded.kind,
          source_node_id = excluded.source_node_id,
          target_node_id = excluded.target_node_id,
          provenance = excluded.provenance,
          confidence = excluded.confidence,
          edge_revision = excluded.edge_revision,
          edge_json = excluded.edge_json
      `;
      yield* sql`
        DELETE FROM knowledge_graph_edge_evidence
        WHERE scope_id = ${edge.scopeId} AND edge_id = ${edge.edgeId}
      `;
      yield* Effect.forEach(
        edge.evidenceIds,
        (evidenceId) =>
          sql`
          INSERT OR IGNORE INTO knowledge_graph_edge_evidence (scope_id, edge_id, evidence_id)
          VALUES (${edge.scopeId}, ${edge.edgeId}, ${evidenceId})
        `,
        { discard: true },
      );
    });

  const readCounts = (scopeId: KnowledgeGraphScopeId) =>
    Effect.gen(function* () {
      const [nodes, edges, evidence, files] = yield* Effect.all([
        sql<{
          readonly count: number;
        }>`SELECT count(*) AS count FROM knowledge_graph_nodes WHERE scope_id = ${scopeId}`,
        sql<{
          readonly count: number;
        }>`SELECT count(*) AS count FROM knowledge_graph_edges WHERE scope_id = ${scopeId}`,
        sql<{
          readonly count: number;
        }>`SELECT count(*) AS count FROM knowledge_graph_evidence WHERE scope_id = ${scopeId}`,
        sql<{
          readonly count: number;
        }>`SELECT count(*) AS count FROM knowledge_graph_file_fingerprints WHERE scope_id = ${scopeId}`,
      ]);
      return {
        nodeCount: nodes[0]?.count ?? 0,
        edgeCount: edges[0]?.count ?? 0,
        evidenceCount: evidence[0]?.count ?? 0,
        indexedFileCount: files[0]?.count ?? 0,
      };
    });

  const commit = (input: {
    readonly scope: KnowledgeGraphScopeV1;
    readonly baseRevision: number;
    readonly nodes: ReadonlyArray<KnowledgeGraphNodeV1>;
    readonly edges: ReadonlyArray<KnowledgeGraphEdgeV1>;
    readonly evidence: ReadonlyArray<KnowledgeGraphEvidenceV1>;
    readonly removedNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
    readonly removedEdgeIds: ReadonlyArray<KnowledgeGraphEdgeId>;
    readonly removedEvidenceIds: ReadonlyArray<KnowledgeGraphEvidenceId>;
    readonly fingerprints: ReadonlyArray<KnowledgeGraphFileFingerprintV1>;
    readonly removedFingerprintPaths: ReadonlyArray<string>;
    readonly changedNodeIds: ReadonlyArray<KnowledgeGraphNodeId>;
    readonly truncation: KnowledgeGraphTruncationV1;
    readonly committedAt: string;
    readonly operation: string;
  }) =>
    sql
      .withTransaction(
        Effect.gen(function* () {
          yield* ensureScope(input.scope);
          const scopeRows = yield* readScope(input.scope.scopeId);
          const scopeRow = scopeRows[0];
          if (scopeRow === undefined) {
            return yield* new KnowledgeGraphRepositoryError({
              operation: input.operation,
              reason: "scope-not-found",
            });
          }
          if (scopeRow.revision !== input.baseRevision) {
            return yield* new KnowledgeGraphRepositoryError({
              operation: input.operation,
              reason: "revision-conflict",
            });
          }
          const revision = scopeRow.revision + 1;

          yield* Effect.forEach(
            input.removedEdgeIds,
            (edgeId) =>
              sql`DELETE FROM knowledge_graph_edges WHERE scope_id = ${input.scope.scopeId} AND edge_id = ${edgeId}`,
            { discard: true },
          );
          yield* Effect.forEach(
            input.removedNodeIds,
            (nodeId) =>
              sql`DELETE FROM knowledge_graph_nodes WHERE scope_id = ${input.scope.scopeId} AND node_id = ${nodeId}`,
            { discard: true },
          );
          yield* Effect.forEach(
            input.removedEvidenceIds,
            (evidenceId) =>
              sql`DELETE FROM knowledge_graph_evidence WHERE scope_id = ${input.scope.scopeId} AND evidence_id = ${evidenceId}`,
            { discard: true },
          );
          yield* Effect.forEach(
            input.removedFingerprintPaths,
            (path) =>
              sql`DELETE FROM knowledge_graph_file_fingerprints WHERE scope_id = ${input.scope.scopeId} AND path = ${path}`,
            { discard: true },
          );
          yield* Effect.forEach(input.evidence, writeEvidence, { discard: true });
          yield* Effect.forEach(input.nodes, writeNode, { discard: true });
          yield* Effect.forEach(input.edges, writeEdge, { discard: true });
          yield* Effect.forEach(
            input.fingerprints,
            (fingerprint) => sql`
            INSERT INTO knowledge_graph_file_fingerprints (
              scope_id, path, fingerprint, size_bytes, modified_at_ms,
              extraction_version, seen_generation
            ) VALUES (
              ${input.scope.scopeId}, ${fingerprint.path}, ${fingerprint.fingerprint},
              ${fingerprint.sizeBytes}, ${fingerprint.modifiedAtMs},
              ${fingerprint.extractionVersion}, ${fingerprint.seenGeneration}
            ) ON CONFLICT (scope_id, path) DO UPDATE SET
              fingerprint = excluded.fingerprint,
              size_bytes = excluded.size_bytes,
              modified_at_ms = excluded.modified_at_ms,
              extraction_version = excluded.extraction_version,
              seen_generation = excluded.seen_generation
          `,
            { discard: true },
          );

          const counts = yield* readCounts(input.scope.scopeId);
          const queueRows = yield* sql<{ readonly count: number }>`
          SELECT count(*) AS count
          FROM knowledge_graph_semantic_queue
          WHERE scope_id = ${input.scope.scopeId}
        `;
          const status: KnowledgeGraphStatusV1 = {
            version: 1,
            scopeId: input.scope.scopeId,
            state: "ready",
            revision,
            ...counts,
            semanticQueueDepth: queueRows[0]?.count ?? 0,
            lastIndexedAt: input.committedAt,
            truncated: input.truncation,
          };
          const requiresSnapshot =
            input.nodes.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES ||
            input.removedNodeIds.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES ||
            input.changedNodeIds.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES ||
            input.edges.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES ||
            input.removedEdgeIds.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES ||
            input.evidence.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE ||
            input.removedEvidenceIds.length > KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE;
          const patch: KnowledgeGraphPatchV1 = {
            version: 1,
            type: "patch",
            scopeId: input.scope.scopeId,
            baseRevision: input.baseRevision,
            revision,
            upsertedNodes: input.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
            removedNodeIds: input.removedNodeIds.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
            upsertedEdges: input.edges.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES),
            removedEdgeIds: input.removedEdgeIds.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EDGES),
            upsertedEvidence: input.evidence.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE),
            removedEvidenceIds: input.removedEvidenceIds.slice(
              0,
              KNOWLEDGE_GRAPH_MAX_VISIBLE_EVIDENCE,
            ),
            changedNodeIds: input.changedNodeIds.slice(0, KNOWLEDGE_GRAPH_MAX_VISIBLE_NODES),
            status,
          };
          yield* sql`
          UPDATE knowledge_graph_scopes SET
            revision = ${revision},
            state = ${status.state},
            status_json = ${encodeStatusJson(status)},
            progress_json = NULL,
            truncation_json = ${encodeTruncationJson(input.truncation)},
            updated_at = ${input.committedAt},
            last_indexed_at = ${input.committedAt}
          WHERE scope_id = ${input.scope.scopeId} AND revision = ${input.baseRevision}
        `;
          if (!requiresSnapshot) {
            yield* sql`
            INSERT INTO knowledge_graph_patch_log (
              scope_id, revision, base_revision, patch_json, created_at
            ) VALUES (
              ${input.scope.scopeId}, ${revision}, ${input.baseRevision},
              ${encodePatchJson(patch)}, ${input.committedAt}
            )
          `;
          }
          yield* sql`
          DELETE FROM knowledge_graph_patch_log
          WHERE scope_id = ${input.scope.scopeId}
            AND revision <= ${revision - KNOWLEDGE_GRAPH_MAX_REPLAY_PATCHES}
        `;
          return {
            version: 1,
            scopeId: input.scope.scopeId,
            baseRevision: input.baseRevision,
            revision,
            patch,
            changedNodes: input.nodes
              .filter((node) => input.changedNodeIds.includes(node.nodeId))
              .map((node) => ({ node, nodeRevision: node.nodeRevision, scopeRevision: revision })),
            delivery: requiresSnapshot ? "invalidate" : "patch",
          } satisfies KnowledgeGraphRepositoryCommit;
        }),
      )
      .pipe(mapError(input.operation));

  const applyDeterministicPatch = (patch: KnowledgeGraphDeterministicPatchV1) =>
    commit({
      scope: patch.scope,
      baseRevision: patch.baseRevision,
      nodes: patch.nodes,
      edges: patch.edges,
      evidence: patch.evidence,
      removedNodeIds: patch.removals.nodeIds,
      removedEdgeIds: patch.removals.edgeIds,
      removedEvidenceIds: patch.removals.evidenceIds,
      fingerprints: patch.fileFingerprints,
      removedFingerprintPaths: patch.removals.fingerprintPaths,
      changedNodeIds: patch.changedNodeIds,
      truncation: patch.truncation,
      committedAt: patch.committedAt,
      operation: "apply-deterministic-patch",
    });

  const applySemanticPatch = (patch: KnowledgeGraphSemanticPatchV1) =>
    Effect.gen(function* () {
      const scopeRows = yield* readScope(patch.scopeId);
      const row = scopeRows[0];
      if (row === undefined) {
        return yield* new KnowledgeGraphRepositoryError({
          operation: "apply-semantic-patch",
          reason: "scope-not-found",
        });
      }
      const truncation = yield* decodeJson(
        decodeTruncationJson,
        row.truncationJson,
        "apply-semantic-patch",
      );
      const edges: ReadonlyArray<KnowledgeGraphEdgeV1> = patch.edges.map((edge) => ({
        version: 1,
        edgeId: KnowledgeGraphEdgeId.make(
          `semantic:${edge.sourceNodeId}:${edge.kind}:${edge.targetNodeId}`,
        ),
        scopeId: patch.scopeId,
        ...edge,
        provenance: "semantic",
        edgeRevision: patch.baseRevision + 1,
      }));
      return yield* commit({
        scope: {
          version: 1,
          scopeId: row.scopeId,
          environmentId: row.environmentId,
          projectId: row.projectId,
          effectiveWorkspaceRoot: row.effectiveWorkspaceRoot,
          isWorktree: row.isWorktree === 1,
        } as KnowledgeGraphScopeV1,
        baseRevision: patch.baseRevision,
        nodes: patch.nodes,
        edges,
        evidence: patch.evidence,
        removedNodeIds: [],
        removedEdgeIds: [],
        removedEvidenceIds: [],
        fingerprints: [],
        removedFingerprintPaths: [],
        changedNodeIds: patch.changedNodeIds,
        truncation,
        committedAt: patch.committedAt,
        operation: "apply-semantic-patch",
      });
    }).pipe(mapError("apply-semantic-patch"));

  const listPatchesAfter = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly afterRevision: number;
  }) =>
    Effect.gen(function* () {
      const rows = yield* sql<JsonRow>`
        SELECT patch_json AS json
        FROM knowledge_graph_patch_log
        WHERE scope_id = ${input.scopeId} AND revision > ${input.afterRevision}
        ORDER BY revision
        LIMIT ${KNOWLEDGE_GRAPH_MAX_REPLAY_PATCHES}
      `;
      return yield* Effect.forEach(rows, ({ json }) =>
        decodeJson(decodePatchJson, json, "list-patches-after"),
      );
    }).pipe(mapError("list-patches-after"));

  const query = (input: {
    readonly scopeId: KnowledgeGraphScopeId;
    readonly query: KnowledgeGraphQueryBatchInput;
  }) =>
    Effect.gen(function* () {
      const snapshotOption = yield* getSnapshot(input.scopeId);
      if (Option.isNone(snapshotOption)) {
        return yield* new KnowledgeGraphRepositoryError({
          operation: "query",
          reason: "scope-not-found",
        });
      }
      const snapshot = snapshotOption.value;
      const results = yield* Effect.forEach(
        input.query.queries,
        (
          operation,
        ): Effect.Effect<KnowledgeGraphQueryOperationResultV1, KnowledgeGraphRepositoryError> =>
          Effect.gen(function* () {
            if (operation.type === "search") {
              const result = yield* searchNodes({
                scopeId: input.scopeId,
                text: operation.text,
                ...(operation.kinds === undefined ? {} : { kinds: operation.kinds }),
                limit: operation.limit ?? Math.min(100, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES),
              });
              const evidence = yield* evidenceForEntities({
                scopeId: input.scopeId,
                nodes: result.nodes,
                edges: [],
              });
              return {
                id: operation.id,
                type: operation.type,
                nodes: result.nodes,
                edges: [],
                evidence: evidence.evidence,
                truncated:
                  result.truncated ||
                  evidence.truncated ||
                  snapshot.status.truncated.eligibleFiles ||
                  snapshot.status.truncated.nodes,
              };
            } else if (operation.type === "node") {
              const bundle = yield* getNodeBundle({
                scopeId: input.scopeId,
                nodeId: operation.nodeId,
              });
              return {
                id: operation.id,
                type: operation.type,
                nodes: Option.isSome(bundle) ? [bundle.value.node] : [],
                edges: [],
                evidence: Option.isSome(bundle)
                  ? bundle.value.evidence.slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE)
                  : [],
                truncated:
                  Option.isSome(bundle) &&
                  bundle.value.evidence.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EVIDENCE,
              };
            } else if (operation.type === "neighbors") {
              const result = yield* queryNeighbors({
                scopeId: input.scopeId,
                nodeId: operation.nodeId,
                direction: operation.direction ?? "both",
                depth: operation.depth,
                ...(operation.kinds === undefined ? {} : { kinds: operation.kinds }),
                limit: operation.limit ?? KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES,
              });
              return { id: operation.id, type: operation.type, ...result };
            } else if (operation.type === "path") {
              const result = yield* queryPath({
                scopeId: input.scopeId,
                sourceNodeId: operation.sourceNodeId,
                targetNodeId: operation.targetNodeId,
                maxDepth: operation.maxDepth ?? 8,
              });
              return { id: operation.id, type: operation.type, ...result };
            }
            const nodes = snapshot.nodes.slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES);
            const nodeIds = new Set(nodes.map(({ nodeId }) => nodeId));
            const matchingEdges = snapshot.edges.filter(
              (edge) => nodeIds.has(edge.sourceNodeId) && nodeIds.has(edge.targetNodeId),
            );
            const edges = matchingEdges.slice(0, KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES);
            const evidence = yield* evidenceForEntities({ scopeId: input.scopeId, nodes, edges });
            return {
              id: operation.id,
              type: operation.type,
              nodes,
              edges,
              evidence: evidence.evidence,
              truncated:
                snapshot.nodes.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_NODES ||
                matchingEdges.length > KNOWLEDGE_GRAPH_MAX_QUERY_RESULT_EDGES ||
                evidence.truncated ||
                snapshot.status.truncated.eligibleFiles ||
                snapshot.status.truncated.nodes ||
                snapshot.status.truncated.visibleNodes,
            };
          }),
      );
      return {
        version: 1,
        scope: snapshot.scope,
        revision: snapshot.revision,
        results,
      } satisfies KnowledgeGraphQueryResultV1;
    }).pipe(mapError("query"));

  const clearScope = (scopeId: KnowledgeGraphScopeId) =>
    sql`DELETE FROM knowledge_graph_scopes WHERE scope_id = ${scopeId}`.pipe(
      Effect.asVoid,
      mapError("clear-scope"),
    );

  const clearEnvironment = (environmentId: KnowledgeGraphScopeV1["environmentId"]) =>
    sql`DELETE FROM knowledge_graph_scopes WHERE environment_id = ${environmentId}`.pipe(
      Effect.asVoid,
      mapError("clear-environment"),
    );

  return {
    ensureScope,
    getSnapshot,
    getStatus,
    getFileFingerprints,
    listScopes,
    updateStatus,
    reconcileSemanticModel,
    getNodeBundle,
    getDeterministicState,
    applyDeterministicPatch,
    applySemanticPatch,
    listPatchesAfter,
    query,
    clearScope,
    clearEnvironment,
  } satisfies KnowledgeGraphRepositoryShape;
});

export const KnowledgeGraphRepositoryLive = Layer.effect(KnowledgeGraphRepository, make);
