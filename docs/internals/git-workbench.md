# Git workbench architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

The Git workbench is a web-and-desktop source-control surface backed entirely by the selected T3 server. The browser never runs Git directly, so local, remote, relay, and tunnel connections use the same contracts and repository rules.

## Capability and transport boundary

Servers advertise `environment.capabilities.gitWorkbenchVersion: 1`. Clients without that capability keep the existing VCS status and header Git control; detailed workbench calls are not attempted.

Workbench wire types live in `packages/contracts/src/gitWorkbench.ts`. Read RPCs require `orchestration:read`; mutations require `orchestration:operate`. Inputs are typed operations, validated refs, object IDs, paths, and server-issued selection IDs. The API does not accept arbitrary Git arguments, shell fragments, or browser-supplied patch text.

`git.subscribeWorkbench` is lazy and emits tagged partial updates for repository state, operations, queued workflows, and undo metadata. The web runtime keys subscriptions and cached reads by environment and effective worktree. History, commit patches, and source buffers are memory-only.

## Server services

- `GitWorkbenchDriver` constructs bounded status and patch commands through the shared VCS process boundary and parses porcelain v2 NUL-delimited status.
- `GitWorkbenchService` validates registered workspaces, publishes detailed state, applies selections, and coordinates mutations with the upstream VCS status broadcaster.
- `GitRepositoryQueryService` builds on `GitVcsDriver` for bounded history, validated branch/path filters, commit detail, patch, rebase-plan, contributor, activity, and Code mix reads. The first history page resolves the chosen ref to a full object ID; every later cursor stays anchored to that snapshot.
- `GitWorkbenchOperations` builds on `GitVcsDriver` and serializes typed branch, reset, revert, cherry-pick, rebase, continuation, and force-with-lease actions.
- `GitWorkbenchUndoService` captures exact local recovery state under hidden `refs/t3/workbench-undo/*` refs and stores retention metadata in SQLite.
- `GitWorkbenchQueueService` and `GitWorkbenchQueueReactor` persist and execute one revalidated post-turn workflow per worktree.
- `TurnQuiescenceNotifier` publishes the same authoritative checkpoint boundary used for the quiesced receipt, without polling or consuming test-only streams.

The existing environment/CWD scheduler is combined with a per-worktree mutation lock. Two clients may read concurrently, but they cannot mutate one index at the same time.

## Standard index and partial selection

The real Git index is authoritative. A normal commit consumes what is already staged; staging another path never resets previous staged content. File, hunk, and line operations send stable IDs plus the expected patch hash and repository state token. The server regenerates the diff before applying a selection and returns a structured stale-state error if it no longer matches.

Binary, submodule, mode-only, and rename-only changes use whole-file operations. Conflict resolution uses base, ours, theirs, and current content rather than partial-patch staging. Discard and destructive operations snapshot local state first.

## Editing and turn coordination

Current-file reads include a content revision, and writes may include `expectedRevision`. Writes use atomic replacement plus root and symlink revalidation. During an active agent turn, the web client holds edits in a device-local memory buffer. Once the turn quiesces it rereads the file and either performs the compare-and-swap write or presents base, user, and current-agent versions.

## Durable workflows and recovery

Queued workflows store the exact environment, worktree, branch, HEAD, opaque index and worktree-content identities, target object IDs, file or patch revisions, and relevant remote IDs. The driver derives the two identities independently so a same-size content edit cannot evade revalidation. The reactor revalidates them after quiescence or server startup. Truncated snapshots cannot seed or execute mutations. Stale workflows move to `needs_review` with explicit reasons and are never silently retargeted.

Undo snapshots retain HEAD/ref identity, an exact index tree, tracked worktree content, and untracked content. Restoring creates another snapshot first. These snapshots are host-local and cannot undo remote history.

## Client layout

`ChatWorkspaceDeckController` owns chat-scoped card selection and composes the Git descriptor into the generic [workspace card deck](./workspace-card-deck.md). The Git card keeps one workbench runtime for the active chat rather than creating a controller per presentation. Detailed repository state remains gated by Git being selected or expanded so the compact summary can show exact index and worktree facts. The more expensive activity, contributor, and Code mix query is gated separately to the expanded Overview tab. Selecting MCP cannot start Git reads.

The Git peek reuses the existing environment, worktree, branch, pull-request, repository-state, and changed-file presentations. One transparent accessible trigger covers its free area and static status, while enabled nested controls remain above the trigger and keep their own actions. The peek can be mirrored above or below the active card without changing control positions.

Git is registered only when the selected workspace has a CWD, legacy status confirms a repository, and the server advertises `gitWorkbenchVersion`. If availability disappears, the controller collapses Git and promotes Chat immediately. Expansion keeps the drawer shell inside the selected Git article and the composer's centered width. The neighboring card peeks remain outside the expanded body, and choosing one finishes the collapse to Chat's reference height before the shuffle starts. The measured overlay height reserves timeline space as the card grows upward, while the right file/diff panel remains independent. Expansion temporarily hides—but does not destroy—the terminal drawer. MCP owns a separate projection and cannot satisfy Git's lazy-loading gate or start repository reads.

The workbench is not exposed on mobile yet.
