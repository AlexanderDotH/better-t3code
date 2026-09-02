# Project Knowledge Graph internals

The Project Knowledge Graph is rebuildable derived data owned by one T3 environment. It does not become part of orchestration history and is never the source of truth for repository content. Source files remain on disk; graph evidence stores bounded provenance and the server reads bounded excerpts on demand.

## Scope identity and isolation

A graph scope is versioned and identified by:

- the environment ID;
- the project ID;
- the canonical effective workspace root.

The effective root is the project root for a normal thread and the canonical worktree root for a worktree thread. The scope ID is derived from all three values. Two worktrees of the same project therefore never share nodes, fingerprints, revisions, semantic jobs, or patches. Canonicalization also prevents aliases to the same root from creating duplicate scopes.

When the feature is enabled, the server resolves every registered project plus every known live worktree, except scopes rooted at the user's home directory or a filesystem root. Those broad roots remain valid T3 projects, but the graph refuses to recursively index or watch them; a narrower project folder or worktree remains eligible. Project and thread lifecycle events reconcile this catalog. A deleted, changed, or ineligible scope is removed from active watching without changing another scope.

## Indexing pipeline

Indexing has two stages.

1. Deterministic extraction inventories eligible repository files, computes incremental fingerprints, and derives repository, package, directory, file, symbol, dependency, technology, documentation, architecture, and co-change records.
2. Optional semantic enrichment receives schema-bounded candidates and evidence from the deterministic graph. A model response may only refer to valid candidate nodes and evidence. Invalid, stale, or unsupported output is rejected before a revision is committed.

One environment-owned watcher multiplexer holds one recursive watcher per effective workspace root. It shares that watcher between scopes rooted at the same directory, ignores generated and sensitive paths before dispatch, and coalesces changes for 175 ms. Index jobs are serialized. While a deterministic run is active, any number of watcher-triggered requests for the same scope coalesce into one pending follow-up; ordinary watcher changes do not interrupt or supersede the active run.

Extraction and diff construction remain cancellable. Once the SQLite revision commit begins, it completes atomically and is not interrupted. Explicit cancel, pause, or feature disable waits for an in-progress commit, then settles the scope to `idle`, `paused`, or `disabled` respectively. Unexpected typed failures publish `error`. Startup repairs orphan `indexing` or `cancelling` states and schedules a fresh index so a process interruption does not leave a scope permanently busy.

The default query for a large graph is a curated overview, not the alphabetically first nodes from the bounded subscription snapshot. It ranks meaningful connectivity without letting `declares` edges make symbol-heavy files dominate, applies per-kind quotas, and returns at most 48 nodes with 120 structurally prioritized internal edges. Graphs with at most 100 nodes retain their complete overview. Web and desktop render this query result; search continues to query the full persisted graph.

The semantic queue is durable and has no usage ceiling. Execution is intentionally bounded to one claimed batch per environment, with at most two candidates in a batch. Claims are fenced by token, scope, node revision, and model generation. Pause, feature disable, environment stop, and server shutdown return running claims to the queue before workers stop. Startup recovery makes interrupted claims available again. A provider rate limit stores its absolute retry deadline and resumes without dropping queued work.

Changing the selected model advances the model generation. Older jobs remain fenced and cannot commit semantic output for the new selection. A provider without the required text-generation capability leaves semantic work unavailable while the deterministic graph remains usable.

## Persistence and revision delivery

Migration 59 creates a separate set of derived-data tables for scopes, nodes, edges, evidence, node and edge provenance, file fingerprints, revision patches, semantic environment state, and the semantic queue. Foreign keys cascade within a scope. Clearing graph data does not delete projects, threads, messages, checkpoints, or repository files.

Every committed deterministic or semantic update advances the scope revision. Subscribers receive one of:

- a snapshot for the current bounded view;
- a patch with an exact base and resulting revision;
- a status-only event;
- an invalidation when the client must request a fresh snapshot.

The server retains at most 256 replay patches per scope. A subscription whose requested revision is outside the replay window receives an invalidation or snapshot instead of an unsafe partial history. Revision and schema fields let newer servers reject incompatible payloads rather than guessing.

Web and desktop use the same React graph panel. When a snapshot contains no nodes, that panel projects `status.state` and `status.progress.phase` into distinct discovery/indexing, extraction, persistence, idle/cancelled, error, and ready-empty presentations. It preserves a separate no-results presentation when a populated snapshot is emptied only by the current search or filters. Snapshot error detail is shown only with the error presentation; mutation controls remain driven by the existing status and actions.

The web layout runs as a bounded force simulation in a dedicated Worker. It streams finite position frames to React, treats relationships as springs, applies node repulsion and label-sized collision radii, and reheats when a dragged pin changes. The Worker stops after 64 iterations or four stable frames, suspends its timer while the document is hidden, and performs no iterative motion under `prefers-reduced-motion`. Pointer coordinates are projected through the same zoom and pan viewport in both directions, so dragging remains accurate after navigating the map. Presentation coordinates and pins remain client-local and never enter the graph contract or database.

## Contract bounds

Contract version 1 applies these limits:

| Boundary                                        |             Limit |
| ----------------------------------------------- | ----------------: |
| Eligible files per scope                        |            25,000 |
| Nodes per scope                                 |           100,000 |
| Nodes in an initial visible snapshot            |               300 |
| Edges in an initial visible snapshot            |             1,200 |
| Evidence records in an initial visible snapshot |               100 |
| Evidence references per node or edge            |                 8 |
| Query operations per request                    |                 8 |
| Query filter values                             |                16 |
| Query result nodes                              |               100 |
| Query result edges                              |               400 |
| Query result evidence records                   |               100 |
| Neighbor depth                                  |                 2 |
| Node-content excerpts                           |                20 |
| Semantic candidates per node                    |                12 |
| Evidence records per semantic candidate         |                 8 |
| Evidence excerpt length                         | 12,000 characters |
| Query input                                     |            64 KiB |
| Snapshot, patch, or aggregate query result      |             8 MiB |

Scope IDs are bounded to 128 characters, node and evidence IDs to 256, edge IDs to 640, semantic job IDs to 512, and claim tokens to 1,024. These limits leave room for every ID currently derived by the server, including semantic edge IDs composed from two node IDs.

Truncation is producer-owned. Snapshots, query results, and extraction status carry explicit truncation information; contract decoding never slices IDs, arrays, or text to make an oversized payload fit. A payload above a field, collection, or encoded-byte limit fails decoding, so the producer must select a bounded view and report what it omitted. These bounds protect WebSocket payload size, layout work, memory, and provider input size.

## RPC, authorization, and mixed versions

The WebSocket API exposes subscribe, query, node content, rebuild, cancel, pause, and clear operations. Subscribe, query, and node content require orchestration-read authorization. Rebuild, cancel, pause, and clear require orchestration-operate authorization.

Servers advertise `knowledgeGraphVersion`. Clients must hide or disable graph controls when the capability is absent or below the contract they understand. This is the mixed-version boundary for local, LAN, relay, and tunnel connections. Payloads remain schema-validated even after capability negotiation.

The built-in MCP tool is named `knowledge_graph_query`. It is read-only, non-destructive, idempotent, and closed-world. It derives the project or worktree scope from the authenticated invocation context. A caller supplies query operations only and cannot provide a filesystem root or invoke rebuild, pause, or clear through MCP.

## Lifecycle controls

- Enabling the feature discovers and indexes every known scope.
- Disabling it prevents new indexing, clears watchers, interrupts deterministic work, safely stops semantic workers, retains preferences, and marks persisted scopes disabled.
- Pausing is environment-wide. It clears watchers, drains active work safely, and preserves all derived data and queued semantic work.
- Resuming restores watchers, reconciles every known scope, and restarts eligible semantic work.
- Cancel stops current work for one scope without deleting its committed graph.
- Rebuild can refresh incrementally, rebuild semantic enrichment, or clear and reconstruct the full derived scope.
- Clear removes either one scope or all scopes in the environment. It emits invalidations so connected clients discard stale revisions.

## Repository content and secrets

The path policy excludes hidden and generated dependency directories, environment files, credential or secret paths, private-key and keystore formats, service-account and OAuth configuration files, package credential files, and other known sensitive filenames. Evidence redacts recognized credentials and tokens. Provider output is still schema-validated and may not invent evidence outside the bounded request.

The graph is a navigation and retrieval aid, not an authorization bypass. Source navigation and node-content reads remain bound to the authenticated environment, project, canonical root, and existing workspace access.
