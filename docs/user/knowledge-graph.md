# Project Knowledge Graph

Knowledge Graph visualizes the same source index used by Project Indexing and agents. It maps files, symbols, and their static relationships; it does not build a separate index or require a model.

## Enable and explore

Enable **Project Indexing** in **Settings → Better T3 → Project Indexing**, then enable and start the selected project’s index in **Settings → Projects**. Each checkout has its own index. The graph becomes searchable after a revision is published. See [Project indexing](project-indexing.md) for setup, supported languages, and index controls.

Open **Knowledge Graph** from a project’s thread. On web and desktop, expand folders and files directly in the map to reveal their contents while keeping surrounding branches visible. Classes expand into their indexed members. Select an expanded node again to collapse it, or select **Project** to collapse all branches. Dashed links show containment; arrows show resolved imports and calls. The overview represents the published snapshot; selected source details are checked for freshness.

Search by file path or the beginning of a symbol name, then select a symbol to inspect its source and connected symbols. On web and desktop, drag the map to pan, scroll to zoom, and choose **Fit graph** to bring the visible branches into view. The symbol list provides another way to select results. A search with no matches keeps the project overview visible.

Large projects use bounded views. Search, follow a connection, or continue to the next results page to explore more of the index. Calls, imports, containment, and uncertain relationships have distinct line styles. A static connection does not prove a runtime execution path. Include stale results when you need to inspect sources that changed since indexing; check their freshness before relying on them.

## Keep it current

The graph follows Project Indexing’s published revisions and updates. Use the project’s indexing settings to pause, resume, rebuild, cancel, or clear its index. These actions do not change source files or chat history.

The owning server supplies graph data to local and remote clients. New agent turns can receive relevant indexed facts automatically, and agents with workspace tools can query the same index through `project_context`. Repository files and generated index data remain on that server.
