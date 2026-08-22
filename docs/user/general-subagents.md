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

Codex, Claude, Cursor, Grok, and OpenCode agents can initiate general delegation. Gemini can be
selected to perform delegated work, but its direct T3 harness does not currently initiate a
subagent itself.

## Lifecycle and permissions

General subagents run asynchronously and appear in the thread's agent stack with their selected
provider, model, reasoning level, progress, and transcript. The main agent should wait for delegated
work to finish, review its result, and perform the final integrated verification.

Each subagent uses the parent thread's workspace and permission mode. A subagent cannot open a
hidden approval prompt or ask you a question directly. If its task requires an approval that cannot
be handled inside the delegated session, it stops and reports the blocker to the main agent.

Unfinished subagents are cancelled when the parent turn ends. You can also stop the parent turn to
interrupt its active delegated work. Provider credentials and execution stay in the environment
that hosts the project, including when you control the thread remotely.
