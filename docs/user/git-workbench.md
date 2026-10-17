# Git workbench

Use the Git workbench to review changes, choose what to commit, and push from a T3 Code chat.
Web and desktop provide the full workbench when the connected server supports it. Mobile keeps
its smaller Git sheet with file staging, active operations, the latest commit, and recent history.

## Open the workbench

Select the Git edge in the [workspace-card stack](./thread-sidebar.md#workspace-cards) to open
**Changes** directly. The normal Commit actions open the same preparation without committing.
The branch picker and other controls in the Git edge keep their own actions.

Git stays within your configured chat width. Collapse it to the compact repository summary, or
select the Chat edge to return to your conversation. Your composer retains its text, attachments,
settings, and focus. An approval or question from the agent brings Chat back automatically.
Finish or cancel voice recording before switching cards.

The compact summary shows the branch, upstream, file counts, ahead/behind counts, and latest
commit. Its suggested action follows the same repository state as the open workbench: resolve
conflicts or a paused operation first, prepare local changes, pull incoming commits, or push
outgoing commits. A diverged branch opens the synchronization controls in **Advanced**.

## Review and stage changes

**Changes** shows one row per file. Each checkbox reflects the actual Git index: unstaged,
partially staged, or fully staged. Selecting a file opens its Diff. For a partially staged file,
choose the staged or unstaged version to inspect each set of changes separately.

Use a file checkbox, **All**, or **None** to change the index. Staging preserves changes already
staged elsewhere, including changes staged by another client or a terminal. Bulk actions run in
order and stop on an error or external repository change. Successful actions remain applied;
review the updated state before retrying.

Select individual added/deleted lines or hunks for partial staging or unstaging. Binary files,
submodules, rename-only changes, and mode-only changes use whole-file actions. If a Diff becomes
stale, refresh it and choose the changes again. Stale selections are never applied to different
content.

On narrower chat widths, the Diff replaces the file list. Use the back action to choose another
file. **Edit** explicitly replaces the Diff with the current file editor; **Back to Diff** returns
to review.

Discard captures a local undo snapshot first. Deleting an untracked file requires confirmation.

## Commit the staged index

The commit area stays available in **Changes** and summarizes the staged files, including partial
stagings. A commit contains the actual index and leaves unstaged changes out. Stage at least one
change before committing.

Choose **Write a message** to enter your own message, or **Generate on commit** to have T3 Code
generate it when you commit. **Commit on new branch** uses the existing branch-creation flow.

Your message stays in memory for the current environment and repository during this app session,
including when you switch chats or tabs. Failed, cancelled, or skipped commits preserve it.
A successful commit clears only the unchanged message submitted with it; edits made while it was
running remain available.

After a successful commit, choose **Push** and the appropriate pull request or merge request
action separately. Nothing is pushed or opened automatically. Existing remote, branch, permission,
and default-branch confirmations still apply.

During an agent turn, **Queue commit after turn** queues a commit of the staged index without
adding Push or a change request. If a workflow already exists, manage it in **Advanced**.

## Edit the current file

The editor changes only the current worktree version. Selecting a Diff does not load the full
file editor. Historical files, binary files, and files over the preview limit remain read-only.

Unsaved edits remain in memory when you confirm leaving the editor. They are not saved to disk
until you select **Save**. Reloading or closing the app ends that session.

If another client or the coding agent changes the file before you save, T3 Code refuses to
overwrite it. You can inspect the base, current agent/server, and buffered versions, then keep
the agent version, explicitly keep yours, or save a manually merged result.

During an agent turn, saved edits stay buffered in device memory. After the turn reaches its
checkpoint, each file is written only if its base version is still current. Changed files remain
available for conflict resolution, even when their editor is closed. Leaving the page with a
buffer produces a warning.

## Inspect history and branches

**History** loads commits in pages of at most 50. Filter by a local or remote branch and an
optional repository path. Later pages stay tied to the first page's resolved commit.

Select a commit for its metadata, changed paths, and individual file patches. Historical content
is read-only. **Open current worktree version** explicitly opens the current file editor, even
when that file has no pending Git changes. Revert and cherry-pick create local recovery state
before changing the repository.

**Branches** lets you create and switch local branches and inspect local and remote refs.
History rewriting lives in **Advanced**.

## Resolve conflicts

When merge, rebase, cherry-pick, or revert pauses, **Changes** shows the operation and conflict
files. Choose a conflict to inspect its Diff, use **Edit** to resolve the current file, save,
and stage the result. **Continue** stays disabled until the updated repository state reports
that all conflicts are resolved. Skip and Abort remain available when the operation supports them.

## Use advanced actions

In **Advanced**, choose Reset, Rebase, or an available Force-with-lease action to open its controls.
Queued workflows and local recovery snapshots are also available there.

Reset modes follow Git semantics:

- **Soft** moves the current branch and preserves the index and worktree.
- **Mixed** also resets the index.
- **Hard** replaces the index and worktree and requires typing `RESET`.

Mixed and hard reset capture a local undo snapshot. T3 Code rechecks the current repository state
before applying an operation.

For rebase, choose a target branch and either start a guided rebase or prepare an interactive plan.
Changing the target hides a plan prepared for another branch. Interactive plans retain Git's
merge structure and support pick, reword, edit, squash, fixup, and drop. Invalid dependency
reordering is blocked.

After history rewriting, **force with lease** compares the remote ref with the exact previously
observed commit and rejects the push if another contributor moved it. Type `FORCE` to confirm.
Raw force push is unavailable; local snapshots cannot restore a remote branch.

## Run workflows after the active turn

Advanced delivery workflows can stage, commit, push, and create a change request. An advanced
operation workflow contains one reset, revert, cherry-pick, or rebase operation.

A workflow waits for the turn's checkpoint and revalidates the repository, selected content,
operation, and relevant remote state. Valid workflows run automatically. Changed preconditions
move the workflow to **Needs review**; T3 Code never retargets it silently. Truncated repository
snapshots cannot be used for mutations or queue creation.

Replacing a workflow requires confirmation. Review, edit, retry, or cancel it in **Advanced**.
Queued workflows survive reconnects and server restarts and are shared by connected clients.

## Inspect repository statistics

**Repository** retains recent activity, top contributors, and the tracked-file code mix.
Statistics load only while this view is visible.

Activity covers the previous 12 months, up to 5,000 reachable commits. Contributors honor
`.mailmap` without showing author email addresses. Code mix excludes common dependency,
generated, vendor, build, coverage, and cache files. It is an approximate file mix. Large
repositories can show sampled or truncated results, with coverage displayed alongside them.

## Restore local work

Recovery snapshots capture local branch, index, worktree, and untracked-file state.
Restoring first captures the current state so you can recover it in turn. Restoring over newer
work requires typing `RESTORE`.

By default, each worktree keeps at most 20 snapshots and removes snapshots older than seven days.
Recovery is local to the repository host and cannot undo a push or another remote-side change.

## Read-only connections and older servers

Read-only credentials can browse repository state, changes, history, patches, and statistics.
Mutations require operate permission.

Older servers and disabled workbenches retain the existing header Git actions and commit dialog.
Git is omitted from the workspace stack when unavailable. Mobile retains its existing fallback
actions. Unsupported repository state is never presented as clean.

Tag and stash management, bisect, submodule management, arbitrary Git commands, remote-history
undo, and historical-file editing are outside the workbench. Patch selection, advanced history
rewriting, and queued workflow editing remain web and desktop features.
