# Encyclopedia

This is a living glossary for T3 Code. It explains what common terms mean in this codebase.

## Table of contents

- [Project and workspace](#project-and-workspace)
- [Thread timeline](#thread-timeline)
- [Orchestration](#orchestration)
- [Provider runtime](#provider-runtime)
- [Internal MCP](#internal-mcp)
- [Project-agent coordination](#project-agent-coordination)
- [User MCP](#user-mcp)
- [Workspace card deck](#workspace-card-deck)
- [Git workbench](#git-workbench)
- [Checkpointing](#checkpointing)

## Concepts

### Project and workspace

#### Project

The top-level workspace record in the app. In [the orchestration contracts][1], a project has a `workspaceRoot`, a title, and one or more threads. See [workspace-layout.md][2].

#### Workspace root

The root filesystem path for a project. In [the orchestration model][1], it is the base directory for branches and optional worktrees. See [workspace-layout.md][2].

#### Worktree

A Git worktree used as an isolated workspace for a thread. If a thread has a `worktreePath` in [the contracts][1], it runs there instead of in the main working tree. Git operations live in [GitCore.ts][3].

### Thread timeline

#### Thread

The main durable unit of conversation and workspace history. In [the orchestration contracts][1], a thread holds messages, activities, checkpoints, and session-related state. See [projector.ts][4].

#### Turn

A single user-to-assistant work cycle inside a thread. It starts with user input and ends when follow-up work like checkpointing settles. See [the contracts][1], [ProviderRuntimeIngestion.ts][5], and [CheckpointReactor.ts][6].

#### Activity

A user-visible log item attached to a thread. In [the contracts][1], activities cover important non-message events like approvals, tool actions, and failures. They are projected into thread state in [projector.ts][4].

### Orchestration

Orchestration is the server-side domain layer that turns runtime activity into stable app state. The main entry point is [OrchestrationEngine.ts][7], with core logic in [decider.ts][8] and [projector.ts][4].

#### Aggregate

The domain object a command or event belongs to. In [the contracts][1], that is usually `project` or `thread`. See [decider.ts][8].

#### Command

A typed request to change domain state. In [the contracts][1], commands are validated in [commandInvariants.ts][9] and turned into events by [decider.ts][8].
Examples include `thread.create`, `thread.turn.start`, and `thread.checkpoint.revert`.

#### Domain Event

A persisted fact that something already happened. In [the contracts][1], events are the source of truth, and [projector.ts][4] shows how they are applied.
Examples include `thread.created`, `thread.message-sent`, and `thread.turn-diff-completed`.

#### Decider

The pure orchestration logic that turns commands plus current state into events. The core implementation is in [decider.ts][8], with preconditions in [commandInvariants.ts][9].

#### Projection

A read-optimized view derived from events. See [projector.ts][4], [ProjectionPipeline.ts][11], and [ProjectionSnapshotQuery.ts][10].

#### Projector

The logic that applies domain events to the read model or projection tables. See [projector.ts][4] and [ProjectionPipeline.ts][11].

#### Read model

The current materialized view of orchestration state. In [the contracts][1], it holds projects, threads, messages, activities, checkpoints, and session state. See [ProjectionSnapshotQuery.ts][10] and [OrchestrationEngine.ts][7].

#### Reactor

A side-effecting service that handles follow-up work after events or runtime signals. Examples include [CheckpointReactor.ts][6], [ProviderCommandReactor.ts][12], and [ProviderRuntimeIngestion.ts][5].

#### Receipt

A lightweight typed runtime signal emitted when an async milestone completes. See [RuntimeReceiptBus.ts][13].
Examples include `checkpoint.baseline.captured`, `checkpoint.diff.finalized`, and `turn.processing.quiesced`, which are emitted by flows such as [CheckpointReactor.ts][6].

#### Quiesced

"Quiesced" means a turn has gone quiet and stable. In [the receipt schema][13], it means the follow-up work has settled, including work in [CheckpointReactor.ts][6].

### Provider runtime

The live backend agent implementation and its event stream. The main service is [ProviderService.ts][14], the adapter contract is [ProviderAdapter.ts][15], and the overview is in [provider-architecture.md][16].

#### Provider

The backend agent runtime that actually performs work. See [ProviderService.ts][14], [ProviderAdapter.ts][15], and [CodexAdapter.ts][17].

#### Session

The live provider-backed runtime attached to a thread. Session shape is in [the orchestration contracts][1], and lifecycle is managed in [ProviderService.ts][14].

#### Runtime mode

The safety/access mode for a thread or session. In [the contracts][1], the main values are `approval-required` and `full-access`. See [runtime-modes.md][18].

#### Interaction mode

The agent interaction style for a thread. In [the contracts][1], the main values are `default` and `plan`. See [runtime-modes.md][18].

#### Assistant delivery mode

Controls how assistant text reaches the thread timeline. In [the contracts][1], `streaming` updates incrementally and `buffered` delivers a completed result. Web and desktop give newly appended streamed characters a short reveal that adapts to the observed output speed; mobile keeps its existing rendering. See [ProviderService.ts][14].

#### Snapshot

A point-in-time view of state. The word is used in multiple layers, including orchestration, provider, and checkpointing. See [ProjectionSnapshotQuery.ts][10], [ProviderAdapter.ts][15], and [CheckpointStore.ts][19].

### Internal MCP

The authenticated MCP server that T3 Code injects into supported provider sessions. It exposes
T3-owned tools with trusted environment and thread context and is separate from user-configured MCP
servers. See [internal-mcp.md][25].

#### Workspace context

The read-only `workspace_context` internal MCP tool. It batches deterministic repository path and
content searches with targeted line-range reads. Its workspace root comes from the authenticated
thread and project rather than tool input. See [internal-mcp.md][25].

### Project-agent coordination

The internal MCP protocol that lets independent active root threads in one project announce work,
hold turn-scoped cooperative path or topic claims, and exchange durable direct or broadcast messages.
Claims prevent two serialized requests from both winning the same overlapping scope but do not lock
the filesystem. Provider-native subagents share their root thread identity, while Fetch workers are
excluded. Messages surface as normal thread activities and remain in an inbox until explicitly
acknowledged at a safe checkpoint. A direct message can wake an inactive retained peer in its
existing thread; broadcasts remain active-peer-only. See [internal-mcp.md][25].

### User MCP

A user-configured Model Context Protocol server stored once in an environment and routed to selected
provider instances. Its durable configuration is distinct from the ephemeral connection and
authentication status reported by a particular provider session. See [mcp-runtime-status.md][26].

#### MCP workspace card

The web-and-desktop workspace card for provider-account-specific MCP configuration and exact-session
runtime management. Its compact surface reports configured, connected, attention, tool-inventory,
and freshness facts; its expanded Servers and Runtime sections share projections with MCP Settings.
Mobile does not expose this card. See [mcp-servers.md][29] and [mcp-runtime-status.md][26].

#### MCP runtime snapshot

A non-persisted, runtime-session-fenced view of the MCP servers an exact provider session reports.
Snapshots distinguish T3-managed, provider-native, and internal system servers and are followed by
live changes. See [mcp-runtime-status.md][26].

#### MCP runtime context

The exact environment, provider instance, thread, and runtime-session identity attached to an MCP
snapshot or action. Ended contexts may remain briefly for inspection, but actions never silently
retarget to a replacement session. See [mcp-runtime-status.md][26].

#### MCP live-apply result

The provider-specific outcome of reconciling a durable MCP catalog change with an active runtime.
The result is applied only after the provider confirms the complete managed set; otherwise it is
pending for the next session, unsupported, or failed with sanitized details. See
[mcp-runtime-status.md][26].

### Git workbench

The server-backed web and desktop workspace for observable repository state, standard-index changes, history, branches, typed Git operations, local undo snapshots, and durable post-turn workflows. It is capability-negotiated and keeps all Git execution on the selected environment. See [git-workbench.md][27].

#### State token

An opaque server-issued identity for the repository state observed by a workbench read. It covers HEAD/ref, index, worktree status, and operation markers. Mutations submit the expected token so stale selections and preconditions fail instead of applying to different repository content.

#### Workbench undo snapshot

A host-local recovery point that preserves branch/HEAD identity, the exact Git index, tracked worktree content, and untracked content before a destructive transition. It is separate from thread checkpoints and cannot reverse remote history.

#### Queued workflow

The single durable post-turn Git workflow retained per worktree. It runs only after authoritative turn quiescence and action-specific revalidation; otherwise it moves to `needs_review` with explicit stale reasons.

### Workspace card deck

The web-and-desktop bottom-workspace carousel containing persistent Chat, capability-gated Git, and
MCP. Only the exposed previous or next card edge changes selection. Bodies remain mounted, but only
the foreground body is interactive and visible to assistive technology. Chat defines the shared
compact height. Expandable panels return to that height before the requested vertical shuffle
begins. See [workspace-card-deck.md][28].

### Checkpointing

Checkpointing captures workspace state over time so the app can diff turns and restore earlier points. The main pieces are [CheckpointStore.ts][19], [CheckpointDiffQuery.ts][20], and [CheckpointReactor.ts][6].

#### Checkpoint

A saved snapshot of a thread workspace at a particular turn. In practice it is a hidden Git ref in [CheckpointStore.ts][19] plus a projected summary from [ProjectionCheckpoints.ts][21]. Capture and lifecycle work happen in [CheckpointReactor.ts][6].

#### Checkpoint ref

The durable identifier for a filesystem checkpoint, stored as a Git ref. It is typed in [the contracts][1], constructed in [Utils.ts][22], and used by [CheckpointStore.ts][19].

#### Checkpoint baseline

The starting checkpoint for diffing a thread timeline. This flow is surfaced through [RuntimeReceiptBus.ts][13], coordinated in [CheckpointReactor.ts][6], and supported by [Utils.ts][22].

#### Checkpoint diff

The patch difference between two checkpoints. Query logic lives in [CheckpointDiffQuery.ts][20], diff parsing lives in [Diffs.ts][23], and finalization is coordinated by [CheckpointReactor.ts][6].

#### Turn diff

The file patch and changed-file summary for one turn. It is usually computed in [CheckpointDiffQuery.ts][20], represented in [the contracts][1], and recorded into thread state by [projector.ts][4].

## Practical Shortcuts

- If you see `requested`, think "intent recorded".
- If you see `completed`, think "result applied".
- If you see `receipt`, think "async milestone signal".
- If you see `checkpoint`, think "workspace snapshot for diff/restore".
- If you see `quiesced`, think "all relevant follow-up work has gone idle".

## Related Docs

- [architecture.md][24]
- [provider-architecture.md][16]
- [runtime-modes.md][18]
- [workspace-layout.md][2]
- [internal-mcp.md][25]
- [mcp-runtime-status.md][26]
- [mcp-servers.md][29]
- [git-workbench.md][27]
- [workspace-card-deck.md][28]

[1]: ../packages/contracts/src/orchestration.ts
[2]: ./workspace-layout.md
[3]: ../apps/server/src/git/Layers/GitCore.ts
[4]: ../apps/server/src/orchestration/projector.ts
[5]: ../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[6]: ../apps/server/src/orchestration/Layers/CheckpointReactor.ts
[7]: ../apps/server/src/orchestration/Layers/OrchestrationEngine.ts
[8]: ../apps/server/src/orchestration/decider.ts
[9]: ../apps/server/src/orchestration/commandInvariants.ts
[10]: ../apps/server/src/orchestration/Layers/ProjectionSnapshotQuery.ts
[11]: ../apps/server/src/orchestration/Layers/ProjectionPipeline.ts
[12]: ../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[13]: ../apps/server/src/orchestration/Services/RuntimeReceiptBus.ts
[14]: ../apps/server/src/provider/Layers/ProviderService.ts
[15]: ../apps/server/src/provider/Services/ProviderAdapter.ts
[16]: ./provider-architecture.md
[17]: ../apps/server/src/provider/Layers/CodexAdapter.ts
[18]: ./runtime-modes.md
[19]: ../apps/server/src/checkpointing/CheckpointStore.ts
[20]: ../apps/server/src/checkpointing/CheckpointDiffQuery.ts
[21]: ../apps/server/src/persistence/Services/ProjectionCheckpoints.ts
[22]: ../apps/server/src/checkpointing/Utils.ts
[23]: ../apps/server/src/checkpointing/Diffs.ts
[24]: ./architecture.md
[25]: ../architecture/internal-mcp.md
[26]: ../architecture/mcp-runtime-status.md
[27]: ../architecture/git-workbench.md
[28]: ../architecture/workspace-card-deck.md
[29]: ../user/mcp-servers.md
