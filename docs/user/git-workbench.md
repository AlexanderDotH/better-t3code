# Git workbench

The Git workbench brings repository context and common source-control tasks into the bottom of a T3 Code chat. It is available in the web and desktop clients when the connected server advertises Git workbench support. Mobile continues to use its existing Git surfaces.

## Open the Git card

The Git overview is one card in the web and desktop [workspace-card carousel](./chat-controls.md#workspace-cards), alongside Chat and MCP. On a new repository thread, Git is the exposed edge below Chat. Select the edge's free area, repository status, or changed-file count to bring Git forward with a vertical shuffle. Its enabled environment, worktree, branch, and pull-request controls keep their original actions instead of switching cards.

When Git is in front, Chat is exposed above and MCP is exposed below. Select either edge to leave Git; there is no separate Return-to-chat control inside the Git card. Your composer remains mounted and retains its draft, attachments, provider settings, and context controls. Selecting the Chat edge restores its previous focus.

The compact Git card shows observable repository facts rather than a generated quality score:

- current branch and upstream;
- clean, changed, conflicted, detached, unborn, stale, or disconnected state;
- staged, unstaged, untracked, and conflicted file counts;
- ahead and behind counts;
- the most recent commit; and
- a contextual next action.

If an agent needs an approval or answer while Git is selected, Chat returns to the front. Finish or cancel active voice recording before switching cards.

Use the upward arrow—or pull the small grabber at the top of the compact card upward—to expand the workbench inside the selected Git card. The card keeps the composer's centered width and grows upward rather than opening a full-width surface across the chat column. The two neighboring card edges stay visible. Selecting one first collapses Git completely to the composer's compact height and only then shuffles the requested card forward. Once expanded, drag Git's top edge vertically to resize it. The remembered height is local to the device. Expanding Git temporarily hides the terminal drawer without closing its terminal sessions; collapsing Git restores it.

## Overview

Overview combines the repository pulse with bounded repository insights:

- **Recent activity** counts reachable commits by day for the previous 12 months, up to 5,000 commits.
- **Top contributors** honors the repository's `.mailmap`. T3 Code shows names and opaque identities, never author email addresses or network avatars.
- **Code mix** classifies a bounded set of tracked source files by extension. It excludes common dependency, vendor, generated, build-output, coverage, and cache directories, plus filenames ending in `.generated.*` or `.gen.*`. It is an approximate tracked-file mix, not a language-quality score. Coverage and truncation are shown alongside it.
- **Queued workflow** shows the one post-turn workflow retained for the current worktree.
- **Undo snapshots** lists recent local recovery points.

Insights load only while Git is expanded on Overview. The compact card continues to subscribe only to the detailed repository state needed for truthful counts. Large repositories may show sampled or truncated insight results.

## Changes and the Git index

The Changes tab uses the standard Git index. It groups files into Conflicts, Staged, Unstaged, and Untracked. A partially staged file can appear in both Staged and Unstaged because it has separate index and worktree changes.

A regular commit contains everything currently staged. T3 Code does not reset the index before committing:

- when files are staged, the primary action is **Commit staged**;
- when only worktree changes exist, the primary action is **Stage all & commit**; and
- staging another file preserves anything already staged.

Text patches can be selected by file, hunk, or individual added/deleted line. T3 Code sends stable selection identifiers to the server; it does not execute patch text supplied by the browser. Binary files, submodules, rename-only changes, and mode-only changes use whole-file operations.

If the repository changes after a diff loads, the workbench marks the selection stale and refreshes it. An operation never silently applies a stale selection to different content.

Discard creates a local undo snapshot first. Deleting an untracked file requires an explicit confirmation. Undo snapshots cannot recover remote history.

## Edit the current file

The editor in Changes edits only the current worktree version. Historical files, binary files, and files over the displayed size limit remain read-only.

Each save includes the revision that was originally read. If another client or the coding agent changed the file, T3 Code refuses to overwrite it and presents:

- the base version;
- the current agent/server version; and
- your buffered version.

You can keep the agent version, explicitly keep your version, or save a manually merged result.

While an agent turn is active, edits stay in device-local memory and are not written to disk. After the turn reaches its checkpoint, T3 Code rereads every buffered file and writes each one only when its own base revision is still current. Buffers whose files changed remain available for three-way resolution, even if they are not currently open. Leaving the page with a buffer produces a warning; source buffers are not stored in browser storage or the server database.

## History

History is topologically ordered and loaded in pages of at most 50 commits. Filter it by a validated local or remote branch and an optional repository path. The first page resolves the selected branch to a snapshot commit so later pages remain stable if new commits arrive.

Select a commit to inspect:

- its full hash, parents, subject, body, author, committer, and timestamps;
- changed paths, renames, additions, deletions, and binary markers; and
- a lazy, bounded patch for an individual file.

Historical files are immutable in the workbench. **Open current worktree version** explicitly switches to the editable current file. Revert and cherry-pick operate on one selected commit at a time and create recovery state before changing the repository.

## Branches and reset

Branches lists local and remote refs and keeps the existing environment, branch, and worktree controls available. You can create or switch a local branch or start a guided rebase onto another ref.

Reset modes follow Git semantics:

- **Soft** moves the current branch and preserves the index and worktree.
- **Mixed** also resets the index.
- **Hard** replaces the index and worktree and requires typing `RESET`.

T3 Code creates a local undo snapshot before mixed or hard reset. The server revalidates the branch, HEAD, index, and active operation immediately before running it.

## Operations and conflicts

When merge, rebase, cherry-pick, or revert pauses, Operations shows its authoritative repository state. Resolve every conflicted current file and stage the completed result before selecting Continue. Skip and Abort appear only when Git supports them for that operation.

Interactive rebase uses Git's merge-preserving plan. Commit actions include pick, reword, edit, squash, fixup, and drop. Structural label, reset, and merge nodes remain visible. T3 Code validates that labels exist before use and prevents reordering that breaks merge dependencies.

After rewritten history, the only overwrite-style push is **force with lease**. It compares the remote ref with the exact previously observed object ID and is rejected if another contributor moved it. Raw force push is not available. Type `FORCE` to confirm; local snapshots cannot restore a remote branch after it is published.

## Run after the active turn

When an agent is working, Git mutations can be stored as one durable workflow for the worktree. A delivery workflow may stage changes, commit, push, and create a pull request. An advanced workflow contains one reset, revert, cherry-pick, or rebase operation.

The server waits for the authoritative turn checkpoint and then revalidates paths, revisions, branch, HEAD, the exact index and worktree identities, operation state, and relevant remote IDs. A valid workflow runs automatically. A stale workflow moves to **Needs review** with the reasons it did not run; T3 Code never retargets it silently. If a repository snapshot was truncated, mutations and queue creation are refused until a complete snapshot can be obtained.

Creating another workflow replaces the current one only after confirmation. Existing workflows can be reviewed, edited, retried with freshly captured preconditions, or cancelled. Queued workflows survive reconnects and server restarts and are visible from connected web and desktop clients.

## Undo scope and retention

Destructive workbench operations capture local HEAD/ref identity, index content, worktree content, and untracked files. Restoring a snapshot first snapshots the current state, which provides redo-like recovery.

By default, each worktree retains at most 20 snapshots and removes snapshots older than seven days. Restoring over newer work requires typing `RESTORE`.

Undo is local to the repository host. It does not reverse a push, pull-request update, or another remote-side change.

## Read-only and older servers

Credentials with orchestration read permission can browse status, changes, history, patches, and insights. Mutation controls are disabled unless the connection also has operate permission.

When an older server does not advertise Git workbench support, T3 Code keeps the existing compact status and header Git shortcut but omits Git from the workspace carousel. Chat and MCP remain available. T3 Code never claims that an unsupported repository is clean.

## Not included

The first workbench release does not add tag management, stash management, bisect, submodule management, arbitrary Git command execution, raw force push, remote-history undo, historical-file editing, or a mobile workbench.
