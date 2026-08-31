# General-purpose subagents

T3 Code lets an agent delegate a focused piece of work to a general-purpose subagent. A subagent can
implement, review, debug, research, or verify work in the same project while the main agent remains
responsible for integrating the result.

This is different from Fetch. Fetch workers are read-only explorers used to gather repository
context before the main turn starts. General subagents can edit files and run focused verification
when the thread's permission mode allows those actions.

## Provider and model selection

The normal default is the current provider, model, and model options. This keeps delegation
predictable and avoids moving work to a different subscription unexpectedly.

When a task benefits from another model, the main agent can inspect the providers and models that
are currently installed, enabled, authenticated, and runnable on the host environment. It can then
select a different provider instance, model, and one of that model's supported reasoning levels. For
example, a security-focused review can use an available specialist model instead of a general model.
T3 Code validates the exact selection before starting work.

Automatic delegation keeps child context lean. The main agent normally sends a self-contained task
brief instead of copying its full transcript. It includes exact recent turns only when the delegated
work needs them; older exact messages remain available through thread context. This keeps a child
focused without deleting or shortening the parent thread.

Codex, Claude, Cursor, Grok, and OpenCode agents can initiate general delegation. Gemini can be
selected to perform delegated work, but its direct T3 harness does not currently initiate a
subagent itself.

## Lifecycle and permissions

General subagents run asynchronously and appear in the thread's agent stack with their selected
provider, model, reasoning level, progress, and transcript. The main agent should wait for delegated
work to finish, review its result, and perform the final integrated verification.

Detailed child results remain canonical in the child transcript. The parent receives a bounded
handoff and a stable result reference, then reads more detail only when integration needs it. Large
tool results use the same reference-first pattern: the model sees a compact digest and can request
the referenced detail instead of receiving the full payload on every continuation. This avoids
copying large results through every agent while keeping them available.

Tool definitions are lazy where the active provider advertises tool search. Other providers receive
a deterministic session profile selected from the features that are actually enabled. Omitting an
unused schema does not delete its result, and referenced detail remains available through
`thread_context`.

On web and desktop, the chat timeline keeps one summary for each workflow run or direct-spawn
batch. While usage is available, that summary shows the provider-reported input, output, and total
token counts. A missing input or output value stays hidden rather than being estimated from the
total. Mobile keeps its existing agent stack and transcript view rather than adding this inline
timeline summary.

Each subagent uses the parent thread's workspace and permission mode. A subagent cannot open a
hidden approval prompt or ask you a question directly. If its task requires an approval that cannot
be handled inside the delegated session, it stops and reports the blocker to the main agent.

Subagents may search project memory for relevant decisions and workflows. Only the root agent can
remember or forget entries, and only when agent writes are enabled.

Unfinished subagents are cancelled when the parent turn ends. You can also stop the parent turn to
interrupt its active delegated work. Provider credentials and execution stay in the environment
that hosts the project, including when you control the thread remotely.

T3 Code does not impose a fixed application-wide agent-count cap. The main agent should still start
only useful independent workstreams. Provider-advertised capabilities and the environment's live
memory protection determine how many can run immediately; excess safe work waits instead of being
silently dropped.
