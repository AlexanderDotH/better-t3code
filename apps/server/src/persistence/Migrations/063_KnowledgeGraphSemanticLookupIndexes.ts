import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // Startup status recovery checks every scope for legacy semantic records.
  // Keep those probes off the much larger deterministic graph indexes.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_nodes_semantic_scope
    ON knowledge_graph_nodes(scope_id) WHERE provenance = 'semantic'
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_semantic_scope
    ON knowledge_graph_edges(scope_id) WHERE provenance = 'semantic'
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_evidence_semantic_scope
    ON knowledge_graph_evidence(scope_id) WHERE kind = 'semantic'
  `;
});
