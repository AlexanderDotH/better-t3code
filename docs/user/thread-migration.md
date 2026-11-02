# Threads from older T3 Code versions

On your first V2 launch, Better T3 Code takes a consistent copy of the V1 database, `state.sqlite`,
into `statev2.sqlite` in the same data directory and migrates that copy. Threads appear automatically;
full transcripts load as needed. You do not need to run an import command.

Allow disk space for a second database, imported history, and temporary migration work. Keeping
recovery data means an upgrade does not necessarily reduce database size.

V1 continues using its original database while V2 uses its copy. V1 can remain open during the
copy. Later conversations and changes in either database do not sync to the other. Opening V2
again resumes your V2 history. Settings files, attachments, and workspace files remain shared,
so changes to them can affect both versions.

The V2 desktop app uses a separate browser profile. Browser cookies and caches do not carry over;
you may need to sign in again to websites opened inside the app. The first launch imports stashed
prompts, unsent drafts, layout, and theme from V1. Existing V2 drafts take precedence. Later changes
to browser-local preferences stay in that profile.

## What carries over

Threads retain their titles, projects, provider and model choices, permission and interaction
modes, branch or worktree, archive and settlement state, snoozes, pins, and linked pull requests.
User and assistant messages retain their text, timestamps, supported attachments, and reply
references. Large histories can appear in stages while transcripts load.

Better T3 also retains compatible Deep Plan state and source snapshots, harness synchronization
links, and subagent and reply conversations. Environment and project settings remain available.
An old provider session is not recreated as a running V2 session.

Old run records, checkpoints and diffs, tool activity, approval history, and proposed plan history
are kept for recovery but are not converted into active V2 timeline items. A saved recovery record
does not make its old checkpoint restorable from V2. The conversation can be present even when
those older activity details are absent.

## Continue a migrated thread

The first new message starts a fresh provider session. Better T3 selects saved user and assistant
messages within the [portable handoff budget](./portable-handoffs.md). Omitted text remains in the
thread and can be retrieved by the agent. A separate recovery excerpt is limited to 32,000
characters; neither that excerpt nor the handoff replaces the full saved transcript.

Before continuing a long or important thread, read the recent transcript and repeat any older
requirements the agent still needs. A new thread with a short handoff is also useful when the old
conversation contains conflicting instructions.

V2 checkpoint review and restore apply to work captured after migration. Returning to V1 opens
the original V1 history; it does not bring back messages or checkpoints created in V2, or undo
workspace changes made since the upgrade.

## Keep a recovery copy

Use **Copy transcript** to keep a readable copy of a connected, settled thread. The export includes
the full saved conversation and is unredacted. See [Copy the full conversation](./thread-sidebar.md#copy-the-full-conversation).

Before a major update, also back up the environment's `userdata` directory. Stop the server before
copying the whole directory so the database and its companion files stay consistent. The default
is `~/.t3/userdata`; a server configured with `--base-dir <path>` uses `<path>/userdata`. Make and
inspect a remote environment's backup on the machine that runs it.

If a migrated transcript is missing, keep the recovery copy unchanged. You can inspect the old
transcript without starting a server against it:

```sh
sqlite3 -readonly /path/to/recovery-copy/state.sqlite
```

At the SQLite prompt, list recent legacy threads:

```sql
.headers on
.mode tabs
SELECT thread_id, title, updated_at
FROM projection_threads
ORDER BY updated_at DESC;
```

Then print a transcript, replacing `<thread-id>` with an ID from that list:

```sql
SELECT role, text, created_at
FROM projection_thread_messages
WHERE thread_id = '<thread-id>'
  AND role IN ('user', 'assistant')
ORDER BY created_at, message_id;
```

Open only the copied database. Do not edit it or point a server at your recovery copy.
