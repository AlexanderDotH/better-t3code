# Provider architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

A provider is the agent runtime that does the actual work. T3 Code supports several, and the
orchestration layer does not know which one is behind a thread.

## Built-in drivers

[`builtInDrivers.ts`][drivers] exports `BUILT_IN_DRIVERS` with six entries:

| Driver kind   | Driver source                           |
| ------------- | --------------------------------------- |
| `codex`       | [`Drivers/CodexDriver.ts`][codex]       |
| `claudeAgent` | [`Drivers/ClaudeDriver.ts`][claude]     |
| `cursor`      | [`Drivers/CursorDriver.ts`][cursor]     |
| `grok`        | [`Drivers/GrokDriver.ts`][grok]         |
| `opencode`    | [`Drivers/OpenCodeDriver.ts`][opencode] |
| `gemini`      | [`Drivers/GeminiDriver.ts`][gemini]     |

Each driver declares its `driverKind`, a `configSchema`, and a `create` function that builds an
adapter in a child scope. Adapter implementations live beside them in
`apps/server/src/provider/Layers/` (`CodexAdapter.ts`, `ClaudeAdapter.ts`, and so on) and conform to
[`ProviderAdapter.ts`][adapter]. Read the driver plus its adapter to see how a specific agent's
transport, config, and event shapes are mapped.

Driver slugs remain extensible for forks and downgrade compatibility. If persisted configuration
names a driver that is not registered in the running build, the registry preserves the opaque entry
and exposes it as unavailable. Users can inspect or remove it without the server inventing an
adapter, probing an unknown command, or making historical threads undecodable.

## Registry and routing

Two registries separate configuration from live processes:

- [`ProviderInstanceRegistry`][instances] keys configured instances by `ProviderInstanceId`. Creating
  one looks up the driver by `driverKind`, decodes `entry.config` with that driver's schema, opens a
  child scope, and calls `driver.create`.
- [`ProviderAdapterRegistry`][registry] resolves an instance ID to its live adapter via
  `getByInstance`.

[`ProviderService`][service] sits on top. It combines the adapter registry with the provider session
directory to route session and turn operations for a thread, so callers name a thread, not an agent.

Adding a driver means writing the driver plus adapter and adding it to `BUILT_IN_DRIVERS`. No
orchestration, contract, or client change is required for the common case.

## Client boundary

Web, desktop, and mobile clients send schema-validated requests over the authenticated RPC socket.
Provider-native events never cross that boundary directly. `ProviderRuntimeIngestion` converts them
into the shared orchestration model, and clients render typed domain events and projections.

## Adapter capabilities

Adapters report capabilities instead of making orchestration branch on provider names. Internal MCP
delivery is one such capability:

| Driver   | MCP delivery               | Workspace context | Project coordination |
| -------- | -------------------------- | ----------------- | -------------------- |
| Codex    | Native configuration       | Yes               | Yes                  |
| Claude   | Session configuration      | Yes               | Yes                  |
| Cursor   | Session configuration      | Yes               | Yes                  |
| OpenCode | Session configuration      | Yes               | Yes                  |
| Grok     | Preview-only configuration | No                | Yes                  |
| Gemini   | Unsupported (direct tools) | Yes               | No                   |

Codex, Claude, Cursor, and OpenCode receive the authenticated `/mcp/workspace` endpoint; Grok
receives `/mcp`. Both expose collaborative preview and project-agent coordination tools, while only
the workspace endpoint adds read-only `workspace_context`. The provider cannot choose another
project, thread identity, or workspace root. User-configured MCP routing and exact-session runtime
health stay separate from this internal server. See [Internal provider MCP](./internal-mcp.md) and
[MCP configuration and runtime status](./mcp-runtime-status.md).

Gemini is deliberately different: T3 is its harness and calls the official `@google/genai` SDK
directly. T3 owns Gemini history, streaming, approvals, interruption, and the function-call loop.
Its `workspace_context`, edit, and bounded command tools invoke T3 services directly instead of
giving the model an MCP transport. User MCP and project-agent coordination are therefore reported
as unsupported by this adapter rather than silently pretending to be connected.

Fetch eligibility is another provider-snapshot capability. Providers without `fetchWorkers` do not
appear in the Fetch model picker. The capability owns the recommended planning budget and command
policy for transient exploration workers:

| Driver   | Initial worker budget | Fetch command policy |
| -------- | --------------------- | -------------------- |
| Codex    | 8                     | Read-only sandbox    |
| Claude   | 8                     | Deny commands        |
| Cursor   | 8                     | Deny commands        |
| Grok     | 8                     | Deny commands        |
| OpenCode | 8                     | Deny commands        |
| Gemini   | 8                     | Deny commands        |

The budget is a provider declaration, not an application-wide clamp. A provider or fork may
advertise a larger supported worker count.

## Fetch preflight

Fetch is a T3-managed preflight and does not depend on the main provider's native-subagent tools.
The server persists one atomic `fetchModelSelection` per environment; `null` means Auto. Resolution
prefers a live non-custom Codex Spark model, then Codex Luna with low reasoning, then the configured
text-generation model when Fetch-capable, and finally the first Fetch-capable provider's default or
first model. Manual selections are strict. Only an Auto-selected Spark model may fall back once to
Luna-low after a typed entitlement or model-unavailable error before workers start.

The client sends only `fetchMode: "repository-exploration"`. It does not choose worker prompts,
counts, provider instructions, or filesystem roots. The server builds bounded repository
orientation and asks the selected text-generation implementation for a structured skip/run plan.
The conservative planner gives the main agent first refusal and chooses zero workers for simple,
focused, or briefly investigative requests that the main agent can handle with its own tools. It
also skips when the user explicitly asks the main agent to work alone or avoid Fetch, workers,
subagents, or delegation. It uses the smallest useful count only when parallel discovery materially
helps; three workers is not a default. The planner has 20 seconds and may choose one through the
provider's advertised budget for genuinely independent scopes. An invalid, failed, or timed-out plan
skips workers.

`FetchWorkerCoordinator` owns one subscription to `ProviderService.streamEvents` and demultiplexes
registered synthetic worker thread IDs. It starts planned workers concurrently as fresh
`purpose: "fetch-worker"` sessions rooted at the parent worktree or project. Their bindings remain
in memory, never enter provider-session persistence, and are removed by exact runtime generation.
They run in plan mode with approval-required semantics, without user MCP servers or delegation
tools. Codex command approvals are permitted only behind its hard read-only sandbox; tool-gated
providers deny commands. Mutation-capable or unknown approvals, observed file changes, dynamic
tools, hidden questions, and nested agents fail the worker.

Only registered, generation-fenced worker events are bridged into the parent thread's durable
subagent projection. Fetch approvals never become parent-thread pending approval state. Summaries
retain `origin: "t3-fetch"`, provider instance, driver, model, terminal state, and transcript after
the transient runtime has gone.

The coordinator captures at most 32,000 characters per worker and fairly allocates at most 64,000
characters across successful findings. Original user input and required transcript handoff take
priority inside the existing provider-input limit. The server-owned `T3 FETCH CONTEXT` labels
findings as untrusted exploratory evidence. Partial failures are retained without retry; total
failure or exhausted input space warns the user and still dispatches the unchanged main turn.

Cancellation ownership transfers atomically from the Fetch planner and exact workers to the normal
turn abort coordinator before the main provider turn is sent. The first stop cooperates, a second
stop forces remaining exact runtimes immediately, and the existing five-second watchdog performs
the same escalation. Cancellation before handoff restores the idle main session and prevents its
turn from being sent.

Fetch selection and execution belong to the environment that hosts the project. Remote clients see
the durable parent and worker state, but provider credentials, model catalogs, worktree access, and
transient runtimes stay on that server. Web and desktop expose Fetch configuration; mobile can
observe and stop a Fetch-enabled turn through existing controls.

## How provider work is requested

Clients never call a provider directly. They dispatch orchestration commands over the RPC method
`orchestration.dispatchCommand`, defined with the rest of the orchestration surface in
[`orchestration.ts`][contracts]. The client-dispatchable provider-facing commands are
`thread.turn.start`, `thread.turn.interrupt`, `thread.approval.respond`,
`thread.user-input.respond`, `thread.checkpoint.revert`, and `thread.session.stop`, plus the mode
setters `thread.runtime-mode.set` and `thread.interaction-mode.set`.

The engine persists an event for the command, and a server-side reactor performs the provider call.
Provider output comes back as internal commands such as `thread.message.assistant.delta` and
`thread.session.set`, which clients observe through `orchestration.subscribeThread`. See
[overview.md](./overview.md) for the command/event loop.

## Server-side workers

Provider work flows through three queue-backed workers. All three are built with
`makeDrainableWorker` from [`DrainableWorker.ts`][worker] and expose `drain` for deterministic test
synchronization.

1. [`ProviderRuntimeIngestion`][ingest] consumes provider runtime streams and emits orchestration
   commands.
2. [`ProviderCommandReactor`][cmd] reacts to orchestration intent events and dispatches provider
   calls.
3. [`CheckpointReactor`][checkpoint] captures workspace checkpoints on turn start and completion, and
   performs reverts.

### Buffered assistant delivery

A thread in `buffered` assistant delivery mode accumulates assistant text instead of streaming each
delta. The buffer is not held until turn completion. In [`ProviderRuntimeIngestion`][ingest],
`MAX_BUFFERED_ASSISTANT_CHARS` is 24,000: the append that would exceed it invalidates the buffer and
spills the whole accumulated text as one delta. The buffer also flushes at interaction boundaries,
when a request opens (approval) or user input is requested, via
`flushBufferedAssistantMessagesForTurn`.

[drivers]: ../../apps/server/src/provider/builtInDrivers.ts
[codex]: ../../apps/server/src/provider/Drivers/CodexDriver.ts
[claude]: ../../apps/server/src/provider/Drivers/ClaudeDriver.ts
[cursor]: ../../apps/server/src/provider/Drivers/CursorDriver.ts
[grok]: ../../apps/server/src/provider/Drivers/GrokDriver.ts
[opencode]: ../../apps/server/src/provider/Drivers/OpenCodeDriver.ts
[gemini]: ../../apps/server/src/provider/Drivers/GeminiDriver.ts
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
