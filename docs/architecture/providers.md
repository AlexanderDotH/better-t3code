# Provider architecture

T3 Code treats a provider as a configured instance of a driver. Drivers create the provider adapter,
model catalog, text-generation support, and maintenance behavior for that instance. The registry is
dynamic, so multiple instances of the same driver and fork-specific drivers can coexist without
changing orchestration contracts.

The built-in registry contains Codex, Claude, Cursor, Grok, and OpenCode, in that order.

Driver slugs remain extensible for forks and downgrade compatibility. When an explicit
`providerInstances` entry names a driver that is not registered in this build, the registry keeps
the opaque configuration and exposes an unavailable snapshot so the entry can still be inspected
and deleted. It does not synthesize a default instance, probe the driver, or start a session.

## Client boundary

Web, desktop, and mobile clients send schema-validated requests over WebSocket. Provider-native
events do not cross that boundary directly. `ProviderRuntimeIngestion` converts them into the shared
orchestration model, and clients render the resulting typed domain events and projections.

## Adapter capabilities

Each adapter reports capabilities instead of making orchestration branch on provider names. MCP
configuration is one such capability:

| Driver   | MCP delivery               | T3 internal workspace tools |
| -------- | -------------------------- | --------------------------- |
| Codex    | Native configuration       | Yes                         |
| Claude   | Session configuration      | Yes                         |
| Cursor   | Session configuration      | Yes                         |
| OpenCode | Session configuration      | Yes                         |
| Grok     | Preview-only configuration | No                          |

Supported adapters receive the authenticated `/mcp/workspace` endpoint, which exposes collaborative
preview tools and the read-only `workspace_context` tool. The provider cannot select another project
or root. User-configured MCP routing and ephemeral per-session health are separate from that internal
server. See [Internal provider MCP](./internal-mcp.md) and
[MCP configuration and runtime status](./mcp-runtime-status.md).

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
