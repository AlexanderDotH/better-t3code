import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_scopes (
      scope_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      effective_workspace_root TEXT NOT NULL,
      is_worktree INTEGER NOT NULL CHECK (is_worktree IN (0, 1)),
      revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
      state TEXT NOT NULL DEFAULT 'idle' CHECK (
        state IN (
          'disabled',
          'idle',
          'indexing',
          'semantic',
          'ready',
          'paused',
          'rate-limited',
          'cancelling',
          'error'
        )
      ),
      model_generation INTEGER NOT NULL DEFAULT 0 CHECK (model_generation >= 0),
      status_json TEXT NOT NULL DEFAULT '{}',
      progress_json TEXT,
      truncation_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_indexed_at TEXT,
      UNIQUE (environment_id, project_id, effective_workspace_root)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_scopes_project_root
    ON knowledge_graph_scopes(environment_id, project_id, effective_workspace_root)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
      scope_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      label TEXT NOT NULL,
      source_path TEXT,
      source_start_line INTEGER,
      source_end_line INTEGER,
      source_symbol TEXT,
      summary TEXT,
      language TEXT,
      provenance TEXT NOT NULL CHECK (provenance IN ('deterministic', 'semantic')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      node_revision INTEGER NOT NULL CHECK (node_revision >= 0),
      node_json TEXT NOT NULL,
      PRIMARY KEY (scope_id, node_id),
      FOREIGN KEY (scope_id) REFERENCES knowledge_graph_scopes(scope_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_nodes_kind_label
    ON knowledge_graph_nodes(scope_id, kind, label, node_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_nodes_source_path
    ON knowledge_graph_nodes(scope_id, source_path, node_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
      scope_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      provenance TEXT NOT NULL CHECK (provenance IN ('deterministic', 'semantic')),
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      edge_revision INTEGER NOT NULL CHECK (edge_revision >= 0),
      edge_json TEXT NOT NULL,
      PRIMARY KEY (scope_id, edge_id),
      FOREIGN KEY (scope_id) REFERENCES knowledge_graph_scopes(scope_id) ON DELETE CASCADE,
      FOREIGN KEY (scope_id, source_node_id)
        REFERENCES knowledge_graph_nodes(scope_id, node_id) ON DELETE CASCADE,
      FOREIGN KEY (scope_id, target_node_id)
        REFERENCES knowledge_graph_nodes(scope_id, node_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_source
    ON knowledge_graph_edges(scope_id, source_node_id, kind, edge_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_edges_target
    ON knowledge_graph_edges(scope_id, target_node_id, kind, edge_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_evidence (
      scope_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      source_path TEXT,
      source_start_line INTEGER,
      source_end_line INTEGER,
      source_symbol TEXT,
      excerpt TEXT CHECK (excerpt IS NULL OR length(excerpt) <= 12000),
      fingerprint TEXT NOT NULL,
      confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
      evidence_revision INTEGER NOT NULL CHECK (evidence_revision >= 0),
      evidence_json TEXT NOT NULL,
      PRIMARY KEY (scope_id, evidence_id),
      FOREIGN KEY (scope_id) REFERENCES knowledge_graph_scopes(scope_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_evidence_source
    ON knowledge_graph_evidence(scope_id, source_path, evidence_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_node_evidence (
      scope_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      PRIMARY KEY (scope_id, node_id, evidence_id),
      FOREIGN KEY (scope_id, node_id)
        REFERENCES knowledge_graph_nodes(scope_id, node_id) ON DELETE CASCADE,
      FOREIGN KEY (scope_id, evidence_id)
        REFERENCES knowledge_graph_evidence(scope_id, evidence_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_edge_evidence (
      scope_id TEXT NOT NULL,
      edge_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      PRIMARY KEY (scope_id, edge_id, evidence_id),
      FOREIGN KEY (scope_id, edge_id)
        REFERENCES knowledge_graph_edges(scope_id, edge_id) ON DELETE CASCADE,
      FOREIGN KEY (scope_id, evidence_id)
        REFERENCES knowledge_graph_evidence(scope_id, evidence_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_file_fingerprints (
      scope_id TEXT NOT NULL,
      path TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      modified_at_ms INTEGER NOT NULL CHECK (modified_at_ms >= 0),
      extraction_version INTEGER NOT NULL CHECK (extraction_version >= 1),
      seen_generation INTEGER NOT NULL CHECK (seen_generation >= 0),
      PRIMARY KEY (scope_id, path),
      FOREIGN KEY (scope_id) REFERENCES knowledge_graph_scopes(scope_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_file_fingerprints_generation
    ON knowledge_graph_file_fingerprints(scope_id, seen_generation, path)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_patch_log (
      scope_id TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
      patch_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (scope_id, revision),
      FOREIGN KEY (scope_id) REFERENCES knowledge_graph_scopes(scope_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_patch_log_created
    ON knowledge_graph_patch_log(scope_id, created_at, revision)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_semantic_environments (
      environment_id TEXT PRIMARY KEY,
      paused INTEGER NOT NULL DEFAULT 0 CHECK (paused IN (0, 1)),
      rate_limited_until INTEGER,
      semantic_model_key TEXT,
      model_generation INTEGER NOT NULL DEFAULT 0 CHECK (model_generation >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= 0)
    )
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS knowledge_graph_semantic_queue (
      job_id TEXT PRIMARY KEY,
      environment_id TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      desired_node_revision INTEGER NOT NULL CHECK (desired_node_revision >= 0),
      model_generation INTEGER NOT NULL CHECK (model_generation >= 0),
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused')),
      claim_token TEXT,
      claimed_at INTEGER,
      available_at INTEGER NOT NULL CHECK (available_at >= 0),
      attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
      candidates_json TEXT NOT NULL,
      failure_category TEXT,
      created_at INTEGER NOT NULL CHECK (created_at >= 0),
      updated_at INTEGER NOT NULL CHECK (updated_at >= 0),
      UNIQUE (scope_id, node_id),
      FOREIGN KEY (scope_id) REFERENCES knowledge_graph_scopes(scope_id) ON DELETE CASCADE
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_semantic_queue_claim
    ON knowledge_graph_semantic_queue(environment_id, status, available_at, updated_at, job_id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_knowledge_graph_semantic_queue_scope
    ON knowledge_graph_semantic_queue(scope_id, node_id, model_generation)
  `;
});
