# Project memory and context

Project memory keeps durable, project-specific facts available across threads and worktrees. Use it
for stable decisions, verified workflows, known pitfalls, project profile details, and recent
outcomes. It is not a copy of the chat transcript.

## Choose the memory source

Each project has one explicit memory mode:

- **Project file** makes T3 Code's project memory authoritative.
- **Provider memory** leaves durable memory to the selected provider and does not also inject the T3
  project file.
- **Off** disables project memory.

In Project file mode, an existing T3 memory document wins. When none exists yet, T3 Code can import
applicable Codex memory once to initialize it. Later reads do not repeatedly merge provider memory
over project-owned edits.

## Where it is stored

T3 Code prefers `<project>/.t3/MEMORY.md` in the canonical project workspace and adds that path to
the repository's local Git exclude when possible. All worktrees for the project resolve through the
same canonical workspace. If that workspace is not writable, storage falls back to the environment's
T3 home under `userdata/project-memories/<project-id>/MEMORY.md`. Settings shows the effective path,
so local and remote clients can tell which location is active.

The file uses stable keys, so remembering the same key replaces that entry instead of appending a
duplicate. Agent writes can be disabled. Even when writes are enabled, subagents can search memory
but cannot remember or forget entries; the root agent owns mutations.

## Keep active context lean

A memory search selects entries relevant to the current task. The returned context uses about 2% of
the model's context window, with a 1,000 to 4,000 estimated-token range. That retrieval budget does
not cap the memory document itself. It prevents durable notes from crowding the user's message,
tools, and current work out of one model turn.

Relevance is evaluated against the current request and project context. T3 Code injects only the
selected entries, not the complete memory document. Usage diagnostics may report the resulting
character count, but never store or render the memory text.

Conversation compaction is separate. A provider-native fork or compaction is used when supported;
otherwise T3 Code sends a compact continuation handoff containing the original goal, current state,
latest exchange, and latest checkpoint. Exact older messages remain in the T3 Code thread and can be
read through thread context. Compaction does not delete project memory or the canonical timeline.

T3 Code does not impose an artificial fixed agent-count cap. It uses lean task briefs for automatic
subagents and lets live provider capabilities and environment memory protection govern concurrency.
