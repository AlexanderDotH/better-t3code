# Project memory

Project memory keeps stable decisions, verified workflows, and known pitfalls available across
threads and worktrees. It is separate from the chat transcript.

Choose the project's memory source in Settings:

- **Project file** uses T3 Code's shared project memory.
- **Provider memory** leaves memory to the selected provider without also injecting the project file.
- **Off** disables project memory.

T3 Code prefers `<project>/.t3/MEMORY.md` in the canonical workspace and excludes it from Git locally
when possible. If that workspace is not writable, it uses the environment's T3 home. Settings shows
the effective path. Worktrees share the canonical project's memory.

An existing project document takes precedence. If none exists, applicable Codex memory can initialize
it once. Remembering an existing key updates that entry instead of duplicating it. Agent writes can
be disabled; subagents can search memory, but the root agent owns changes.

Only relevant excerpts enter a turn's context. Compaction preserves the durable memory and canonical
thread history; older messages remain available through thread-context tools.
