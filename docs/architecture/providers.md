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

| Driver   | MCP delivery               | Workspace context | Project coordination |
| -------- | -------------------------- | ----------------- | -------------------- |
| Codex    | Native configuration       | Yes               | Yes                  |
| Claude   | Session configuration      | Yes               | Yes                  |
| Cursor   | Session configuration      | Yes               | Yes                  |
| OpenCode | Session configuration      | Yes               | Yes                  |
| Grok     | Preview-only configuration | No                | Yes                  |

Codex, Claude, Cursor, and OpenCode receive the authenticated `/mcp/workspace` endpoint; Grok receives
`/mcp`. Both endpoints expose collaborative preview and project-agent coordination tools, while only
the workspace endpoint adds read-only `workspace_context`. The provider cannot select another
project, thread identity, or root. User-configured MCP routing and ephemeral per-session health are
separate from that internal server. See [Internal provider MCP](./internal-mcp.md) and
[MCP configuration and runtime status](./mcp-runtime-status.md).

Fetch eligibility is another provider-snapshot capability. Providers without `fetchWorkers` do not
appear in the Fetch model picker. The capability owns both the recommended planning budget and the
command policy for transient workers:

| Driver   | Initial worker budget | Fetch command policy |
| -------- | --------------------- | -------------------- |
| Codex    | 8                     | Read-only sandbox    |
| Claude   | 8                     | Deny commands        |
| Cursor   | 8                     | Deny commands        |
| Grok     | 8                     | Deny commands        |
| OpenCode | 8                     | Deny commands        |

The budget is a per-provider declaration, not an application clamp. A provider or fork that
advertises ten or more workers allows the Fetch planner to return that larger count.

## Fetch preflight

Fetch is a T3-managed preflight and does not depend on the main provider's native-subagent tools.
The server persists one atomic `fetchModelSelection` per environment; `null` means Auto. Web and
server execution share the same deterministic resolver: live non-custom Codex Spark, then Codex
Luna with low reasoning, then the configured text-generation selection when Fetch-capable, then the
first Fetch-capable provider's default or first model. Manual selections are strict and never
silently replaced. Only Auto-selected Spark may fall back once to Luna-low after a typed
model-unavailable or entitlement error before workers start.

The client sends only the existing `fetchMode: "repository-exploration"` marker. It does not send
worker prompts, counts, or provider instructions. The server builds bounded repository orientation
and asks `planFetchExploration` on the selected text-generation implementation for a structured
skip/run plan. The planner has 20 seconds and may choose zero workers or one through the provider's
advertised budget; an invalid, failed, or timed-out plan becomes one broad worker.

`FetchWorkerCoordinator` owns one subscription to `ProviderService.streamEvents` and demultiplexes
registered synthetic worker thread IDs. It starts every planned worker concurrently as a fresh
`purpose: "fetch-worker"` transient session at the parent worktree or project root. Transient
bindings remain in memory, never enter provider-session persistence or resume after restart, and are
removed by exact runtime generation during terminal cleanup. Fetch sessions run in plan mode with
approval-required runtime semantics, without configured/user MCP servers or delegation tools.
Codex command approvals are allowed only behind its hard read-only sandbox; tool-gated providers
deny commands. Mutation-capable and unknown approval requests are declined; observed file changes
or dynamic tools, hidden questions, and nested agents fail the worker. Each worker has a five-minute
lifecycle timeout without polling.

Only registered, generation-fenced worker events are bridged into the parent thread's durable
subagent projections. Fetch approvals stay inside worker transcripts and never create parent-thread
pending approval state. The summaries record `origin: "t3-fetch"`, provider instance, and provider
driver; terminal success, error, timeout, interruption, and startup-orphan reconciliation remain
visible after the transient runtime is gone.

The coordinator captures at most 32,000 characters per worker and fairly allocates at most 64,000
characters across successful findings. Original user input and required transcript handoff take
priority under the existing 120,000-character provider-input limit. The resulting server-owned
`T3 FETCH CONTEXT` labels findings as untrusted exploratory evidence. Partial failures are retained
without retry; all-worker failure or exhausted input space produces a warning and still dispatches
the unchanged main turn.

Turn startup marks the main orchestration session as starting while planner and workers settle, then
hands cancellation ownership atomically to the normal abort coordinator before sending the main
provider turn. A first stop interrupts the planner and exact worker runtimes, a second stop forces
the remaining exact runtimes immediately, and the existing five-second watchdog performs the same
escalation. Cancellation before handoff restores the idle main session and prevents its turn from
being sent.

Fetch selection and execution belong to the environment hosting the project. Remote clients see
the parent thread as busy and receive the durable worker projection, but provider credentials,
model catalogs, worktree access, transient runtimes, and the persisted selection stay on that remote
T3 server. Web and desktop expose Fetch enablement; mobile can observe and stop the turn through
existing session controls without exposing its own enable switch.

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
