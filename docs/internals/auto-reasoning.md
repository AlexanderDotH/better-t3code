# Auto Reasoning

Auto Reasoning is a Codex-only presentation over a model's existing `reasoningEffort` descriptor.
It does not add a provider reasoning value. A durable `ModelSelection` keeps both
`t3AutoReasoning: true` and the last concrete `reasoningEffort`; the latter is the deterministic
fallback. Selecting a concrete effort removes the Auto marker. Provider adapters receive the
selection after the marker is stripped.

`ServerSettings.autoReasoningModelSelection` selects the structured text-generation model used for
evaluation. `null` means the existing `textGenerationModelSelection`, which the Better T3 selector
presents as **Automatic**. The selector accepts normal model options but never the Auto marker,
preventing recursive routing. Auto remains a Codex-only target, while Codex, Claude, Cursor, Grok,
OpenCode, and any other provider exposed by the structured text-generation selector can supply the
evaluator model.

When an Auto-enabled user message is submitted, orchestration passes the isolated evaluator the
current prompt, attachment metadata, and exactly the three newest earlier user or assistant
messages, in chronological order. If the thread has fewer than three eligible prior messages, it
passes all available messages. The current prompt remains separate and never counts toward the
three-message limit; user and assistant messages count equally. Prompt and message text still use
the router's bounded representation. The evaluator compares individual requests and bullet items
with explicit prior outcomes, then chooses effort for only the remaining or newly requested work.
Deep cross-layer or cross-client wiring, difficult diagnosis, persistence, concurrency, security,
and verification can raise effort. Conversation length, prompt verbosity, and already completed
work cannot by themselves raise it. The evaluator has no project files, tools, MCP, memory, skills,
or subagents.

The evaluator must return one effort from the live `reasoningEffort` options advertised by the
target Codex model. Orchestration validates that value before applying it to the main turn. A failed
or invalid evaluation, or the 15-second timeout, uses the stored concrete fallback. Retrying the
same submitted message reuses its resolved effort and does not call the evaluator again.

After a routed turn is accepted, orchestration projects a content-free activity:

- kind: `auto-reasoning.resolved`
- real parent turn ID
- resolved effort and whether the saved fallback was used
- evaluator provider/model identity, duration, and optional aggregate token usage

Web, desktop, and mobile display **Auto** until a resolution exists, then append the effort actually
used, for example **Auto \* High**. They read this value from the content-free resolution activity;
the display does not change the durable model selection and never appends the fallback state. The
activity also remains available for retry reuse, subagent inheritance, diagnostics, and usage
attribution, and it does not expose routing prompt content.

Usage scanners attribute the existing `<t3code_auto_reasoning_call>` marker to the distinct
`auto-reasoning` call kind. They retain token totals and routing character counts, not routing
prompt content. Cache creation, reads, uncached input, output, and reasoning keep the same disjoint
accounting rules as every other call.
