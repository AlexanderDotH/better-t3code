import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { migrationEntries } from "./LegacyForkMigrations.ts";

// Every fork addition after divergence is idempotent, including the historical
// collision repairs. Keep their dependency order when upgrading native upstream.
export default Effect.gen(function* () {
  for (const [id, , migration] of migrationEntries) {
    if (id >= 36) yield* migration;
  }
  const sql = yield* SqlClient.SqlClient;
  // Evidence deletion cascades through these foreign keys. The primary keys
  // place node_id/edge_id before evidence_id and cannot serve that lookup.
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_node_evidence_evidence
    ON knowledge_graph_node_evidence(scope_id, evidence_id)
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edge_evidence_evidence
    ON knowledge_graph_edge_evidence(scope_id, evidence_id)
  `;
});
