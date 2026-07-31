# Provider architecture

T3 Code treats a provider as a configured instance of a driver. Drivers create the provider adapter,
model catalog, text-generation support, and maintenance behavior for that instance. The registry is
dynamic, so multiple instances of the same driver and fork-specific drivers can coexist without
changing orchestration contracts.

Built-in drivers include Codex, Claude Agent, Cursor, Grok, OpenCode, Gemini, Hyperagent, and the
hosted/OpenAI-compatible variants registered in `builtInDrivers.ts`.

## Client boundary

Web, desktop, and mobile clients send schema-validated requests over WebSocket. Provider-native
events do not cross that boundary directly. `ProviderRuntimeIngestion` converts them into the shared
orchestration model, and clients render the resulting typed domain events and projections.

## Adapter capabilities

Each adapter reports capabilities instead of making orchestration branch on provider names. MCP
configuration is one such capability:

| Driver                         | MCP delivery               | T3 internal workspace tools |
| ------------------------------ | -------------------------- | --------------------------- |
| Codex                          | Native configuration       | Yes                         |
| Claude Agent                   | Session configuration      | Yes                         |
| Cursor                         | Session configuration      | Yes                         |
| OpenCode                       | Session configuration      | Yes                         |
| Grok                           | Preview-only configuration | No                          |
| Gemini                         | Unsupported                | No                          |
| Hyperagent and hosted adapters | Unsupported                | No                          |

Supported adapters receive the authenticated `/mcp/workspace` endpoint, which exposes collaborative
preview tools and the read-only `workspace_context` tool. The provider cannot select another project
or root. See [Internal provider MCP](./internal-mcp.md).

## Server-side orchestration

Provider runtime events flow through queue-backed workers:

1. **ProviderRuntimeIngestion** consumes provider event streams and emits orchestration commands.
2. **ProviderCommandReactor** reacts to orchestration intent and dispatches provider calls.
3. **CheckpointReactor** captures Git checkpoints and publishes typed runtime receipts.

These workers expose deterministic drains for tests. Async callers wait on receipts and drains
instead of polling provider, projection, or Git state.

Provider sessions preserve the same orchestration vocabulary regardless of adapter: projects own
threads, turns produce messages and activities, and checkpoint work settles before a turn is fully
quiescent. Provider-specific complexity stays inside the adapter boundary.
