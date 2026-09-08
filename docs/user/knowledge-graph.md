# Project Knowledge Graph

The Project Knowledge Graph gives you a navigable map of a repository. It connects files, symbols, packages, technologies, documentation, dependencies, and other relationships so you can move from a project overview to the source that supports a result.

The graph is optional and starts disabled on new installations.

## Enable and open the graph

Open **Settings > Better T3 > Knowledge and automation**, then enable **Knowledge Graph**. T3 Code begins indexing every project registered in the connected environment, including known worktrees. Each worktree has its own graph. A project whose root is your entire home directory or a filesystem root remains usable for chats, but is not recursively indexed or watched; add a narrower project folder to use its graph.

Open the graph from a project or thread. On web and desktop it appears in the right panel. On phone and tablet it opens as a full-screen view.

You can:

- search for nodes;
- filter node types;
- zoom and pan the map;
- drag nodes to pin them in place while connected nodes react through the physics layout;
- expand one node for details;
- inspect provenance and confidence;
- open the related source;
- use the accessible relationship list instead of the visual layout.

Reduced-motion preferences are respected. Large repositories show a small, balanced overview of central repository, package, directory, file, dependency, and technology nodes instead of an arbitrary alphabetical slice. Search and expansion retrieve more of the persisted graph without trying to render the whole repository at once.

The web and desktop map animates only while its force layout is settling. Relationships act like springs, nodes repel one another, and label-sized collision bounds keep pills from stacking on top of each other. Dragging a node briefly restarts that bounded simulation so its neighbors move with it. The simulation stops after a fixed amount of work, pauses while the document is hidden, and is skipped entirely when reduced motion is requested. **Reset view** releases dragged pins, restores pan and zoom, and lays out the visible map again.

Before the first nodes are available, the web and desktop panel shows what the server is doing instead of presenting every empty view as finished. It distinguishes file discovery/indexing, relationship extraction, saving the graph, an idle or cancelled run, a failure, and a successful graph with no indexed knowledge. A failed view includes the server's error detail when available; use the existing **Rebuild**, **Resume**, or **Cancel** controls as offered by the current state. A search or filter with no matches is shown separately and does not imply that the project graph itself is empty.

## Deterministic and model-assisted indexing

T3 Code always builds the deterministic part first from repository structure and source relationships. If you select a compatible model, it may add schema-validated semantic relationships. Model enrichment is queued and processed conservatively in the background. Rate limits pause that queue and resume it later without discarding pending work.

A graph may report that it is truncated when the repository exceeds a safety bound. This means T3 Code kept indexing and rendering within its documented limits, not that the repository was changed.

## Keep the graph current

T3 Code watches eligible project files after the initial index. External edits that arrive while an update is running are coalesced into one follow-up update instead of repeatedly restarting the active work. Restarting the server recovers interrupted indexing state and background enrichment work.

Use the controls in **Settings > Better T3 > Knowledge and automation** when needed:

- **Pause** stops watching and background processing while retaining the graph and queue.
- **Resume** reconciles the project again and continues queued work.
- **Rebuild** refreshes the graph. Incremental rebuild preserves reusable data, semantic rebuild recreates model enrichment, and full rebuild reconstructs all derived graph data for the scope.
- **Cancel** stops the current indexing work without deleting the committed graph. If an atomic graph save has already begun, T3 Code finishes that save before cancellation settles to idle.
- **Clear** deletes derived graph data for the chosen scope or environment. It does not delete repository files, projects, threads, messages, or checkpoints.

Clearing is reversible by rebuilding. Turning the feature off also retains its setting and derived data so it can be enabled again later.

## Privacy and repository safety

The graph runs on the T3 server that owns the environment. Repository files stay on that machine. T3 Code stores derived nodes, relationships, fingerprints, and bounded evidence separately from chat history; it does not copy full source bodies into the graph database.

Known secret locations and file types are excluded, including environment files, credential and secret directories, private keys, keystores, package credential files, service-account files, and OAuth or token configuration. Recognized credentials in evidence are redacted. Keep normal repository access controls in place because the graph reflects files that the connected T3 environment can read.

When model enrichment is enabled, only bounded candidate and evidence data is sent through the selected compatible provider. Deterministic indexing remains available without model enrichment.

## Remote and agent access

The Knowledge Graph works through the same capability-gated connection used by web, desktop, and mobile clients. If an older server does not advertise Knowledge Graph support, clients hide or disable the controls instead of sending unsupported requests.

Agents can query the current thread's graph through the read-only `knowledge_graph_query` tool. The server chooses the authenticated project or worktree scope. The tool cannot select an arbitrary filesystem root and cannot rebuild, pause, clear, or otherwise modify graph data.
