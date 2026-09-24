# Project Knowledge Graph internals

The Knowledge Graph is rebuildable derived data owned by one T3 environment. It has its own lifecycle and store, separate from Project Indexing. Both features derive facts from local repository content and make no automatic model calls. The explicit Project Indexing diff review remains separate from either index.

## Scope and evidence

A graph scope binds the environment, project, and canonical effective workspace root. A worktree therefore has its own graph and revision even when it shares Git metadata with the main checkout. Project and thread lifecycle events reconcile registered scopes. Home directories and filesystem roots are too broad to index or watch.

Extraction inventories eligible files, fingerprints them, and derives repository, package, directory, file, symbol, dependency, technology, documentation, and co-change records. Only relationships backed by repository metadata or local source analysis may be emitted. An unresolved target remains a gap; a graph connection must not be presented as a proved runtime path. Legacy model-generated nodes and edges are excluded from reads and are retired after deterministic replacement is committed.

The graph stores bounded provenance rather than full source bodies. Sensitive paths are excluded and recognized credentials in evidence are redacted. A node-content read remains bound to the authenticated environment and canonical root. The built-in `knowledge_graph_query` MCP tool is read-only and derives its scope from the authenticated invocation context.

## Updates and publication

An environment-owned watcher multiplexer shares one recursive watcher per effective workspace root, excludes generated and sensitive paths, and coalesces nearby changes. Index jobs are serialized. Changes arriving during a run cause one follow-up reconciliation. Pause and feature disable stop watching and background work while retaining published data. Resume reconciles current source; rebuild reconstructs derived data. No model queue or worker participates in these transitions.

Extraction and diff construction can be cancelled. Graph revisions commit atomically in the environment's RocksDB store, separate from the main T3 database and the Project Indexing store. A reader receives only a committed revision. Startup repairs orphan active states and schedules fresh deterministic work where indexing is enabled. The last committed graph remains available during replacement, and deletion removes only derived graph data, never projects, threads, messages, checkpoints, or repository files.

Subscriptions carry snapshots, revision-based patches, status events, or invalidations. A client outside the bounded patch replay window requests a new snapshot. Large repositories receive a curated, bounded overview; search and expansion query persisted data without rendering the entire graph. The web layout has a finite worker simulation and stops when settled, hidden, or reduced motion is requested.

## Contracts and mixed versions

The server advertises `knowledgeGraphVersion`, and clients gate graph actions on the supported static version for local, LAN, relay, and tunnel connections. Payloads remain schema validated after capability negotiation. Query and snapshot limits protect WebSocket size and client layout work; truncation is reported by producers instead of silently slicing source facts. Read RPCs require orchestration-read authorization, while rebuild, pause, cancel, and clear require orchestration-operate authorization.
