import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE IF NOT EXISTS git_workbench_queue (
      environment_id TEXT NOT NULL,
      worktree_root TEXT NOT NULL,
      workflow_id TEXT NOT NULL UNIQUE,
      thread_id TEXT NOT NULL,
      turn_id TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('waiting_for_turn', 'ready', 'running', 'needs_review', 'failed')
      ),
      revision INTEGER NOT NULL CHECK (revision >= 1),
      workflow_json TEXT NOT NULL,
      preconditions_json TEXT NOT NULL,
      review_reasons_json TEXT NOT NULL DEFAULT '[]',
      last_error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (environment_id, worktree_root)
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_git_workbench_queue_turn
    ON git_workbench_queue(thread_id, turn_id, status)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_git_workbench_queue_recovery
    ON git_workbench_queue(status, updated_at, workflow_id)
  `;

  yield* sql`
    CREATE TABLE IF NOT EXISTS git_workbench_undo_snapshots (
      id TEXT PRIMARY KEY,
      cwd TEXT NOT NULL,
      worktree_root TEXT NOT NULL,
      reason TEXT NOT NULL,
      branch_ref TEXT,
      head_oid TEXT,
      base_ref_namespace TEXT NOT NULL,
      index_tree_oid TEXT NOT NULL,
      worktree_commit_oid TEXT NOT NULL,
      captured_state_token TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_git_workbench_undo_scope_created
    ON git_workbench_undo_snapshots(cwd, created_at DESC, id)
  `;

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_git_workbench_undo_expiry
    ON git_workbench_undo_snapshots(expires_at, id)
  `;
});
