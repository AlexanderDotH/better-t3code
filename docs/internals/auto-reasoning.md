# Auto Reasoning

Auto Reasoning is a Codex-only presentation over a model's existing `reasoningEffort` descriptor.
It does not add a provider reasoning value. A durable `ModelSelection` keeps both
`t3AutoReasoning: true` and the last concrete `reasoningEffort`; the latter is the deterministic
fallback. Selecting a concrete effort removes the Auto marker. Provider adapters receive the
selection after the marker is stripped.

`ServerSettings.autoReasoningModelSelection` selects the structured text-generation model used for
the decision. `null` means the existing `textGenerationModelSelection`. The settings selector
accepts normal model options but never the Auto marker, preventing recursive routing.

When an Auto-enabled user message is submitted, the isolated router receives the conversation
origin, the newest prior user/assistant messages that fit the routing budget, attachment metadata,
and a head-and-tail view of the current prompt. It compares individual requests and bullet items
with explicit prior outcomes, then chooses effort for only the remaining or newly requested work.
Deep cross-layer or cross-client wiring, difficult diagnosis, persistence, concurrency, security,
and verification can raise effort. Conversation length, prompt verbosity, and already completed
work cannot by themselves raise it. The router still has no project files, tools, MCP, memory,
skills, or subagents. Retrying the same message reuses its resolved effort and does not call the
router again.

After a routed turn is accepted, orchestration projects a content-free activity:

- kind: `auto-reasoning.resolved`
- real parent turn ID
- resolved effort and whether the saved fallback was used
- router provider/model identity, duration, and optional aggregate token usage

Clients read the latest valid resolution but display it only while the current durable selection
still has the Auto marker. This prevents a previous resolution from surviving a manual switch.
While Auto is active, clients suppress manual post-turn effort recommendations.

Usage scanners attribute the existing `<t3code_auto_reasoning_call>` marker to the distinct
`auto-reasoning` call kind. They retain token totals and routing character counts, not routing
prompt content. Cache creation, reads, uncached input, output, and reasoning keep the same disjoint
accounting rules as every other call.
