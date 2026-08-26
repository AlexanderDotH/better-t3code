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

`NativeProviderHarness` supplies the provider-neutral direct-tool strategy, while
`NativeProviderMcpToolBridge` attaches the authenticated T3 coordination endpoint and configured
MCP servers. Drivers translate only their own boundary errors; OpenRouter does not depend on a
ChatGPT-specific tool implementation.

The MCP bridge reserves enough of the 90-definition request budget for the native workspace tools.
If internal and configured MCP servers advertise more than the remaining direct slots, internal
tools and the first configured tools stay direct while two bounded gateway tools search and invoke
the complete session-local catalog. Tool schemas remain available through search without sending
hundreds of definitions on every provider round.

## Driver behavior

| Driver               | Protocol state                                         | Context policy                         | Tool surface                                 |
| -------------------- | ------------------------------------------------------ | -------------------------------------- | -------------------------------------------- |
| ChatGPT Subscription | Responses items                                        | Subscription compaction endpoint       | Workspace, user MCP, internal MCP            |
| Gemini               | `@google/genai` contents                               | Existing Gemini behavior               | Direct T3 tools, no user MCP or coordination |
| OpenRouter           | Canonical transcript plus protocol-tagged opaque items | Explicit OpenRouter compression policy | Workspace, user MCP, internal MCP            |

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

## Compatibility and failure behavior

Changing a provider instance's protocol closes that instance scope. Its next session reconstructs
the request from the visible T3 transcript and drops opaque reasoning that cannot cross protocol
formats. Other provider instances remain untouched.

Malformed streams, missing required parameters, catalog drift, invalid credentials, payment errors,
and exhausted context fail visibly. The harness never changes provider instance, account, model, or
protocol as an implicit recovery action.
