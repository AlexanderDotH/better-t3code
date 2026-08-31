# Project memory

Project memory is a project-bound, deterministic Markdown store exposed to agents through one
authenticated internal MCP tool. It is distinct from provider-native memory and from conversation
history compaction.

## Policy and precedence

`ProjectMemoryMode` has three values. `project` activates the T3-owned store, `provider` leaves
memory to the provider, and `off` returns no memory. Modes are exclusive, so orchestration never
silently combines two active memory sources. In project mode, an existing T3 document is
authoritative. Initialization may import applicable task groups from Codex's native
`memories/MEMORY.md` only when no T3 document exists. The explicit import operation follows the same
create-only rule.

The authenticated thread projection supplies the project ID and canonical workspace root. Tool
input cannot choose another project, workspace, or file path. Root agents may save or delete only
when `allowAgentWrites` is true. Child agents may read but fail closed on mutations.

## Storage

The preferred path is `<canonical-workspace>/.t3/MEMORY.md`. The store attempts to add
`.t3/MEMORY.md` to the repository's local `info/exclude`; it does not edit tracked ignore files. A
read-only workspace falls back to
`<t3-home>/userdata/project-memories/<encoded-project-id>/MEMORY.md`. Writes are atomic and serialized
per project. Stable keys provide deterministic replacement, and entries retain their source thread,
verification flag, and optional checkpoint reference.

## Retrieval and context continuity

Search tokenizes the query, ranks exact key and content matches deterministically, and fits complete
entries before truncating one final entry. The budget is 2% of the supplied model context window,
clamped to 1,000 through 4,000 estimated tokens. This is an injection budget, not a storage or usage
ceiling.

Automatic Codex delegation defaults to `fork_turns: "none"` with a self-contained child brief. Exact
recent turns are inherited only when required; `thread_context` remains the path to older canonical
messages. A thread fork uses a compatible provider-native cursor when available, otherwise a
content-filtered `<t3code_context_handoff>` with the original goal, current state, latest exchange,
and latest checkpoint. Canonical history remains durable regardless of provider compaction.

Concurrency has no application-wide fixed agent cap. Provider capabilities define supported native
fan-out, while the resource governor queues starts against live memory pressure. This is separate
from bounded prompt construction and memory retrieval.
