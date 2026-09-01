# Native provider harness

The native provider harness is the server-owned execution core for providers whose upstream API is
not itself a complete coding-agent runtime. `makeNativeProviderAdapter` implements the normalized
`ProviderAdapterShape`; a built-in `ProviderDriver` supplies scoped strategies for its protocol and
policy differences.

This is an internal server SPI. It is not an external plugin ABI and it does not accept an arbitrary
HTTP endpoint from provider settings.

## Core ownership

The harness owns:

- session lifecycle, interruption, terminal-event consistency, and working-set eviction;
- T3-owned history files, turn boundaries, rollback, and resume cursors;
- approval waits;
- bounded parallel tool rounds and transcript projection;
- resource-admission leases and provider-independent runtime events.

A driver-owned strategy bundle supplies:

- request encoding and strict stream decoding;
- provider history state and opaque replay values;
- model discovery and capability mapping;
- compaction or context-overflow policy;
- tool declarations, execution policy, and system instructions;
- limits, usage and cost normalization, and error translation.

The protocol boundary returns a normalized round containing visible assistant text, visible
reasoning, tool calls, a provider history delta, usage, cost, and a stop reason. Orchestration and
clients never consume provider-native stream shapes.

The implementation keeps these responsibilities separate. `NativeProviderAdapter` is the wiring
facade. `NativeProviderSessionLifecycle` owns attachment reads, resume validation, session state,
interruption, rollback, and cleanup. `NativeProviderTurnExecutor` owns one serialized turn and its
bounded tool loop. `NativeProviderSessionStore`, `NativeProviderToolExecutor`, and
`NativeProviderRoundProjection` own persistence, tool execution, and runtime-event projection
respectively. Drivers configure those boundaries instead of reimplementing them.

`NativeProviderHarness` supplies the provider-neutral direct-tool strategy, while
`NativeProviderMcpToolBridge` attaches the authenticated T3 coordination endpoint and configured
MCP servers. Drivers translate only their own boundary errors; OpenRouter does not depend on a
ChatGPT-specific tool implementation.

`NativeProviderAdapter` resolves the shared resource governor when a strategy does not supply a
specialized admission policy. The resulting provider-neutral in-process lease covers the complete
model and tool loop and is released on success, failure, cancellation, or interruption. This is the
Gemini path. Strategies with an explicit admission implementation retain it, while isolated tests
without a governor keep the compatibility no-op.

The MCP bridge reserves enough of the 90-definition request budget for the native workspace tools.
If internal and configured MCP servers advertise more than the remaining direct slots, internal
tools and the first configured tools stay direct while two bounded gateway tools search and invoke
the complete session-local catalog. Tool schemas remain available through search without sending
hundreds of definitions on every provider round.

## Workspace tools

ChatGPT Subscription, OpenRouter, OpenAI Responses, and Gemini advertise the same two T3-owned
workspace contracts. `workspace_context` batches bounded search and reads. `workspace_edit` performs
single-file or mixed UTF-8 write, exact-replace, range-splice, and delete batches through
`WorkspaceFileSystem`. Shared direct-harness instructions require multi-file regular UTF-8 discovery
to use the fewest batched `workspace_context` calls its limits allow, not shell text readers or
searchers.

New rounds advertise one mutation tool rather than overlapping `write_file`, `replace_text`, and
`apply_patch` definitions. Completed calls using those legacy names replay only as persisted provider
history records; the names are neither advertised nor executable in new rounds. The shared
`workspace_edit` executor keeps the existing approval and file-change event path. Plan mode,
read-only sessions, and Fetch workers advertise only `workspace_context`; workspace-write and
full-access turns may advertise `workspace_edit`.

The direct tool uses the same schema, size limits, revision guards, path fencing, compact results,
and batch recovery rules as authenticated internal MCP. Commands remain the fallback for formatters,
generators, binaries, oversized files, permission changes, recursive operations, globs, regular
expressions, copy, and move.

## Driver behavior

| Driver               | Protocol state                                         | Context policy                         | Tool surface                                        |
| -------------------- | ------------------------------------------------------ | -------------------------------------- | --------------------------------------------------- |
| ChatGPT Subscription | Responses items                                        | Subscription compaction endpoint       | Direct workspace tools, user MCP, internal MCP      |
| Gemini               | `@google/genai` contents                               | Existing Gemini behavior               | Direct workspace tools, no user MCP or coordination |
| OpenRouter           | Canonical transcript plus protocol-tagged opaque items | Explicit OpenRouter compression policy | Direct workspace tools, user MCP, internal MCP      |
| OpenAI Responses     | Stateless Responses output items                       | T3-owned bounded history               | Direct workspace tools, user MCP, internal MCP      |

The ChatGPT and Gemini strategy adapters preserve their existing persisted envelopes and
continuation identities. Extracting the core must not turn a history refactor into a user-visible
migration or broaden Gemini's advertised capabilities.

## OpenRouter rules

OpenRouter uses the fixed `https://openrouter.ai/api/v1` origin and rejects cross-origin redirects.
Each request contains one exact model and `require_parameters: true`; it never contains a `models`
fallback list. Chat Completions reasoning details are replayed byte-for-byte through tool rounds.
OpenResponses uses `store: false` and does not depend on `previous_response_id`.

Provider-routing settings are per instance. The serializer emits either explicit provider order or
sort, never both, and omits inherited fallback and privacy values. The simple numeric performance
preferences map to OpenRouter's p50 form. Context compression always emits an explicit enabled or
disabled plugin entry so account and small-context defaults cannot silently truncate T3 history.

OpenRouter credentials are instance-scoped. A submitted key is validated before atomic replacement;
the fallback environment lookup reads only the instance's sensitive `OPENROUTER_API_KEY` entry.
Snapshots expose only display-safe key metadata.

Catalog discovery requests `/models?output_modalities=all` with the instance credential and keeps
every uniquely identified model. Capability projection classifies text output, required tool
calling, modalities, context size, reasoning options, and pricing. Models without text output or
tool support remain in the snapshot as non-selectable entries with a display-safe reason. Default
selection, text generation, subagents, Fetch workers, and adapter dispatch all recheck this
classification rather than relying on picker filtering.

## OpenAI Responses rules

OpenAI Responses uses the fixed `https://api.openai.com/v1` origin and rejects cross-origin
redirects. Each request uses the exact selected model, `store: false`, and
`include: ["reasoning.encrypted_content"]`. T3 does not send `previous_response_id`; it persists and
replays the ordered response output items required for stateless continuation. Encrypted reasoning
content stays opaque, while a returned reasoning summary is normalized into the common reasoning
stream.

The live `/models` response is intersected with release-tested capability metadata. A live but
untested model never becomes selectable, and every start, turn, text-generation request, Fetch
plan, and Knowledge Graph enrichment rechecks model availability. Strict structured output is used
for server-owned text-generation operations.

The provider exposes only T3-owned tools. Custom function calls are decoded into the common tool
loop, bounded for parallel execution, and returned as `function_call_output` items. T3 owns
approvals, workspace access, MCP bridging, checkpoints, resource admission, interruption, rollback,
and exact-runtime stop fencing. Hosted shell and provider-side MCP execution are not used.
Fetch-worker tool discovery suppresses all configured and coordination extensions before resolving
their sessions; only the built-in read-only workspace-context tool remains available.
OpenAI's upstream strict-function flag remains off because native and configured MCP schemas may
contain optional fields outside that strict JSON Schema subset. T3 validates native-tool arguments
before execution, while configured MCP calls remain inside the authenticated bridge and retain the
owning MCP server's schema validation.

Credentials are isolated per provider instance. A stored API key takes precedence over that
instance's sensitive `OPENAI_API_KEY` environment value. Submitted replacements are validated
before atomic storage; snapshots contain only a masked label and compatible-model count.

## Compatibility and failure behavior

Changing a provider instance's protocol closes that instance scope. Its next session reconstructs
the request from the visible T3 transcript and drops opaque reasoning that cannot cross protocol
formats. Other provider instances remain untouched.

Malformed streams, missing required parameters, catalog drift, invalid credentials, payment errors,
and exhausted context fail visibly. The harness never changes provider instance, account, model, or
protocol as an implicit recovery action.
