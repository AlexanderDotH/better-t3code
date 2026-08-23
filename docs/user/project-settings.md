# Project settings

Open **Settings**, select **Projects**, then select **Configure** for a project. Settings apply to
each checkout in the selected project group. You can also open the project switcher in the main
sidebar and select the settings button next to a project.

## Checkpoints

T3 Code creates hidden Git checkpoints before and after agent turns. They power turn diffs and
restore actions, but can add noticeable overhead in very large repositories.

Turn off **Create checkpoints** for projects where that overhead is a problem. New turns stop
creating checkpoint refs and provider diff placeholders; existing checkpoints are kept and can
still be restored. Turn processing and Git status updates continue normally.

Each checkout stores this setting on its own environment. Changing a normalized project group
updates every checkout in the group. T3 Code attempts the update on all connected environments even
if one fails, then identifies every environment that needs attention.

If grouped checkouts disagree, the control shows **Mixed**. In that state, each checkout continues
using its own saved value: enabled checkouts create checkpoints and disabled checkouts do not. Use
**Enable all** or **Disable all** to normalize the group. These actions are serialized, so a second
click cannot overlap an update that is still in progress; after a partial failure, retry the desired
action once the unavailable environment is reachable.

## Project icon

T3 Code selects a project icon automatically. It checks `t3.json`, common favicon and app icon
paths, and icon links in project HTML files.

To choose a different icon:

1. Select **Choose file** next to **Project icon**.
2. Search for an image file and select it.

T3 Code supports SVG, PNG, ICO, JPEG, GIF, AVIF, and WebP files. The selected path applies to
each checkout in the project group and appears on your connected clients.

To use automatic detection again, select **Automatic**.

## Sync chats from agent harnesses

The **Harness chat sync** section at the top of **Settings > Projects** finds conversations saved by
the agent harnesses on each connected environment. Opening the page only reads the available
history. T3 Code does not copy anything until you select **Sync selected**.

Each environment is scanned independently. A phone or remote browser asks that environment's T3
server to read its own Codex, Claude Code, OpenCode, Cursor, or Grok history; provider credentials
and source files never move to the client. Other harness providers appear automatically when their
driver advertises history sync. Gemini conversations already use T3 Code as their harness and are
shown as already local instead of as a second import source. A provider that cannot expose history
reports that limitation without hiding chats previously synced from it.

Non-archived, top-level chats are selected by default. Search, **Include archived**, and **Load
more** refine the result list without resetting selection. You can exclude individual chats from
the default selection, or choose **Clear all** and select only specific chats.

T3 Code assigns a source chat to a project from its working directory:

1. An exact directory match uses the existing project.
2. An existing directory without a project creates a project for that directory.
3. If the directory no longer exists, choose a target project before syncing. You can apply that
   choice to every unresolved chat in the same sync.

Sync is additive and safe to repeat. New source messages are appended to the same T3 thread;
messages already in T3 Code are never deleted or rewritten because the source was edited, rolled
back, or removed. Per-chat failures do not discard chats that synced successfully.

Synced chats keep a private link to the original provider session, so the next turn in T3 Code
continues that session instead of forking a new one. A session confirmed active in another harness
can still be synced and read, but T3 Code disables sending until a status refresh reports it idle.
Providers that cannot report activity are not assumed to be active.

There is no background polling. Reopen the Projects page or refresh a source to check for changes,
then run **Sync selected** again. **Import chats** remains a separate tool for migrating chats from
another T3 Code installation; those imported chats receive local session identities and do not
resume the source provider session.
