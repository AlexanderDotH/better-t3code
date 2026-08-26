# Thread forking

Thread forking creates a durable thread in the source project and copies a frozen timeline prefix
through one completed message or proposed-plan boundary. It is an orchestration operation, not a
client-side transcript import and not a provider-native session fork.

## Contract and atomic creation

Servers advertise support with the optional `threadForking` environment capability. Clients hide
fork actions when it is absent and dispatch `thread.fork` only over a live connection. The command
contains a client-generated destination thread ID, source thread ID, exact boundary, current model
and runtime selections, and the workspace defaults resolved by the client.

`ThreadForkPlanner` runs after command-receipt deduplication. It reconstructs the source prefix from
the event stream, validates the boundary, remaps every copied identifier, and
assigns a global `historyOrigin.ordinal` across messages, activities, plans, subagents, turns, and
checkpoints. The planner emits `thread.created` and `thread.forked` together, so an invalid boundary,
target-ID collision, or projection failure cannot leave a partial destination.
Nested forks reconstruct the already inherited prefix before applying the new boundary.

`thread.forked` stores source provenance, ordered history, pending workspace state, and provider
handoff budgets. Migration 55 adds the fork projection state. Existing entity projections retain
their normal query, search, export, attachment, and diff paths, with `historyOrigin` marking rows as
immutable inherited history. Projectors must not let those rows create current liveness, actionable
plans, pending approvals, live subagent controls, latest-turn state, or reversible checkpoints.

## Workspace and first provider turn

The destination never inherits the source thread's worktree or branch. Local mode is ready at fork
creation and uses the project root. Worktree mode stores its base branch, origin preference, and
setup-script choice, then `orchestrationCommandDispatcher` prepares it once immediately before the
first native turn. A setup failure records `thread.fork-workspace-updated` with error state, keeps
the fork, and prevents the user message from being appended. Retrying the turn retries preparation
without creating a second worktree after readiness is recorded.

The first provider request always starts a fresh session. `providerTranscriptHandoff` serializes
only client-visible frozen history, includes supported inherited attachments, and excludes private
reasoning, provider cursors, MCP sessions, credentials, approvals, and runtime-only payloads. Fork
creation always preserves the complete canonical prefix. On the first provider turn, the newest
complete history entries and supported inherited attachments are fitted into the capacity left after
the user's message and attachments. Older provider context may be omitted with an explicit handoff
notice, but it remains present in the forked timeline. The user's message keeps the ordinary provider
input and attachment limits.

`ProviderCommandReactor` prepends this handoff exactly once. It marks the handoff complete only
after `sendTurn` succeeds. Build or send failures leave it pending for retry, while a completed
handoff is never added to later turns. Model or provider changes on the first turn still use the
selected destination configuration and cannot resume the source conversation.

## Client behavior

Web, desktop, and mobile expose the action on committed user messages, completed non-streaming
assistant messages, and finalized plan cards. Duplicate dispatches are disabled while a fork is in
flight. Success navigates directly to the durable destination and focuses its composer; failure
leaves the source selected and displays the server error.

Forked timelines show source provenance and place **Fork starts here** after the inherited row with
the greatest global ordinal. Read-only actions remain available on inherited rows, while approval,
plan implementation, checkpoint revert, and other mutations are gated by `historyOrigin`.
