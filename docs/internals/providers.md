# Provider architecture

> For maintainers. Using T3 Code? See [docs/user](../user/).

A provider is the agent runtime that does the actual work. T3 Code supports several, and the
orchestration layer does not know which one is behind a thread.

## Built-in drivers

[`builtInDrivers.ts`][drivers] exports `BUILT_IN_DRIVERS` with nine entries:

| Driver kind   | Driver source                               |
| ------------- | ------------------------------------------- |
| `codex`       | [`Drivers/CodexDriver.ts`][codex]           |
| `chatgpt`     | [`Drivers/ChatGptDriver.ts`][chatgpt]       |
| `openrouter`  | [`Drivers/OpenRouterDriver.ts`][openrouter] |
| `openai`      | [`Drivers/OpenAiDriver.ts`][openai]         |
| `claudeAgent` | [`Drivers/ClaudeDriver.ts`][claude]         |
| `cursor`      | [`Drivers/CursorDriver.ts`][cursor]         |
| `grok`        | [`Drivers/GrokDriver.ts`][grok]             |
| `opencode`    | [`Drivers/OpenCodeDriver.ts`][opencode]     |
| `gemini`      | [`Drivers/GeminiDriver.ts`][gemini]         |

Each driver declares its `driverKind`, a `configSchema`, and a `create` function that builds an
adapter in a child scope. Adapter implementations live beside them in
`apps/server/src/provider/Layers/` (`CodexAdapter.ts`, `ClaudeAdapter.ts`, and so on) and conform to
[`ProviderAdapter.ts`][adapter]. Read the driver plus its adapter to see how a specific agent's
transport, config, and event shapes are mapped.

Provider adapters are wiring boundaries, not secondary orchestration stacks. Codex keeps exact
session ownership in `CodexAdapterSession`, native MCP control in `CodexMcpRuntime`, and runtime
event mapping in `CodexRuntimeEventMapper`. T3-managed delegation similarly separates public
coordination, worker lifecycle, provider transport, state, and orchestration projection. These
boundaries keep stop fencing and replay behavior provider-neutral while protocol details remain in
their adapters.

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

## Turn request policy

Optional Better T3 response policy is applied once in `ProviderCommandReactor`, immediately before
the main `ProviderService.sendTurn` activation. The reactor reads the current environment settings
for that activation, resolves the versioned Deep Thinking flag, and prepends one bounded policy
block for Deep Thinking and Caveman Mode. Provider adapters remain unaware of these controls.

Deep Thinking consumes the configured step count, refinement-pass bound, parallel toggle, batch
size, and durable-provider preference as private reasoning organization. It does not start extra
provider calls, tools, or agents. Caveman Mode changes response brevity only. Neither mode changes
stored user messages, tool availability, approvals, sandbox or runtime policy, output schemas, or
system and developer instructions. With both modes off, the provider input is byte-equivalent to
the input produced by the rest of orchestration. If the optional block would exceed the provider
input limit, T3 omits the block instead of truncating required user or transcript content.

## Client boundary

Web, desktop, and mobile clients send schema-validated requests over the authenticated RPC socket.
Provider-native events never cross that boundary directly. `ProviderRuntimeIngestion` converts them
into the shared orchestration model, and clients render typed domain events and projections.
Workspace editing adds no client request, setting, command-palette action, or keybinding. Existing
tool activity, changed-file, Git, and checkpoint projections provide observation and reversal across
local web, hosted web, desktop, and mobile. Relay, tunnel, and other remote clients behave the same:
the server in the environment that owns the workspace executes the authenticated operation.

## Adapter capabilities

Adapters report capabilities instead of making orchestration branch on provider names. Internal MCP
delivery is one such capability:

| Driver     | MCP delivery               | Workspace context | Workspace edit | Project coordination |
| ---------- | -------------------------- | ----------------- | -------------- | -------------------- |
| Codex      | Native configuration       | Yes               | Yes            | Yes                  |
| ChatGPT    | T3-native MCP bridge       | Yes               | Yes            | Yes                  |
| OpenRouter | T3-native MCP bridge       | Yes               | Yes            | Yes                  |
| OpenAI     | T3-native MCP bridge       | Yes               | Yes            | Yes                  |
| Claude     | Session configuration      | Yes               | Yes            | Yes                  |
| Cursor     | Session configuration      | Yes               | Yes            | Yes                  |
| OpenCode   | Session configuration      | Yes               | Yes            | Yes                  |
| Grok       | Preview-only configuration | No                | No             | Yes                  |
| Gemini     | Unsupported (direct tools) | Yes               | Yes            | No                   |

Codex, Claude, Cursor, and OpenCode receive an authenticated workspace profile selected from the
session's runtime permissions. Read-only, approval-required, and Fetch sessions receive only
`workspace_context`; writable sessions also receive `workspace_edit`. Plan is turn-scoped, so a
writable profile may still list the tool, but injected instructions do not recommend it and the
server rejects the call before disk access. Grok receives `/mcp`, so its preview and coordination
transport does not expose either workspace tool. The provider cannot choose another project, thread
identity, or workspace root. User-configured MCP routing and exact-session runtime health stay
separate from this internal server. See
[Internal provider MCP](./internal-mcp.md) and
[MCP configuration and runtime status](./mcp-runtime-status.md).

Gemini is deliberately different: T3 is its harness and calls the official `@google/genai` SDK
directly. T3 owns Gemini history, streaming, approvals, interruption, and the function-call loop.
Its `workspace_context`, `workspace_edit`, and bounded command tools invoke T3 services directly
instead of giving the model an MCP transport. User MCP and project-agent coordination are therefore
reported as unsupported by this adapter rather than silently pretending to be connected.

ChatGPT Subscription is also T3-harnessed, but its Early Access bridge combines direct workspace
tools with the authenticated internal T3 MCP endpoint and the MCP servers configured for that
provider instance. Internal subagent, preview, and coordination tools retain their public names;
configured MCP tools are namespaced by server to prevent collisions. See
[ChatGPT Subscription harness](./chatgpt-subscription-harness.md).

All four server-owned harness drivers use that same direct workspace contract. New rounds advertise
one `workspace_edit` mutation definition in place of `write_file`, `replace_text`, and `apply_patch`;
completed legacy calls remain replayable only as provider history records, not executable tool
names. The common executor preserves the existing approval and file-change event path.

OpenRouter uses the same server-owned execution core with a different authentication, catalog,
protocol, routing, and context-policy strategy bundle. Its stable default is Chat Completions; the
OpenResponses strategy is explicitly beta. Both expose T3 tools rather than delegating the coding
loop to an upstream agent SDK. See [Native provider harness](./native-provider-harness.md).

OpenAI Responses is a distinct API-key driver on the same server-owned execution core. It uses the
official Responses endpoint with stateless T3-owned history, filters the live account catalog
through tested capability metadata, and exposes only T3-owned tools. It does not share ChatGPT
Subscription credentials or delegate approvals and MCP execution to hosted provider tools. See
[Native provider harness](./native-provider-harness.md).

## Harness history synchronization

Historical discovery is an optional provider-instance capability separate from the live
`ProviderAdapter`. [`ProviderHistorySync.ts`][history-sync] defines `ProviderHistorySyncFacet`,
`ProviderHistorySyncAdapter`, `ProviderHistorySyncSource`, `ProviderHistorySyncCapabilities`, and
`ProviderHistorySyncError`. Each `ProviderInstance` provides a `historySync` facet that reports
`supported`, `unsupported` with a reason, or `already-local`. Supported adapters implement `list`,
`read`, and `resumeCursor`, plus optional `checkActivity`. The generic sync service enumerates these
capabilities and never branches on a driver slug. New harness drivers therefore participate by
implementing the SPI rather than changing orchestration or client code.

The server-side sync facade in [`harnessChatSync.ts`][harness-sync] coordinates four focused
boundaries. `HistoryDiscovery` owns provider grouping, bounded pagination, cursor compatibility,
and short-lived summary caches. `TranscriptNormalization` owns native summary/message normalization
and bounded attachment persistence. `Reconciliation` owns additive project, thread, message, plan,
resume-binding, and link updates. The facade owns only RPC-facing source, list, run, and status
coordination. Deterministic identifiers and persisted native-message links keep retries idempotent.

| Driver        | History source                                   | Continuation behavior                         |
| ------------- | ------------------------------------------------ | --------------------------------------------- |
| Codex         | App-server `thread/list` and `thread/read`       | Resumes the original Codex thread             |
| ChatGPT       | T3-owned atomic history                          | Resumes T3's persisted subscription session   |
| OpenRouter    | T3-owned atomic history                          | Replays the selected protocol from T3 history |
| OpenAI        | T3-owned atomic Responses history                | Replays stateless Responses output items      |
| Claude Code   | SDK history in the instance's configured home    | Resumes the original SDK session/cursor       |
| OpenCode      | SDK `session.list` and `session.messages`        | Resumes the original OpenCode session         |
| Cursor / Grok | ACP session listing and loading, when negotiated | Resumes only when the ACP agent supports both |
| Gemini        | T3-owned history                                 | Reported as already local                     |

Codex excludes ephemeral and child threads. Claude Code has no archive or activity API. OpenCode
excludes sessions with a parent, preserves archive metadata, and maps `busy`/`retry` to `active`.
The shared ACP implementation requires both the advertised session-list capability and top-level
session loading; without either it returns a typed unsupported reason. ACP currently has no session
activity API.

Sources sharing a `continuationKey` are merged so two configured instances that see the same
provider home do not produce duplicate rows. Existing links retain their provider instance. A new
link uses the requested compatible instance or the source's preferred active instance.

The adapter maps only user-visible user/assistant text, plans, and supported image/audio
attachments into the canonical orchestration model. System and developer prompts, hidden reasoning,
tool output, child-agent sessions, and transient execution sessions are not imported. Provider-native
IDs remain server-side metadata and are used to make repeated syncs idempotent.

Synchronization writes projects, threads, and messages through orchestration commands. Link and
native-message projections make it additive: new source messages may be appended, but source edits,
rollbacks, or deletion never remove or rewrite durable T3 history. The provider session directory
stores the native resume cursor as a stopped binding, so importing history does not start a provider
process or a turn.

An adapter may report a source session as `active`, `idle`, or `unknown`. `active` links remain
readable but cannot start a T3 turn until a later explicit status request reports `idle`; `unknown`
is not treated as active. Discovery and status are request-driven—there is no background poller.
All reads happen on the environment that owns the provider configuration and history, including
when the request originates from a remote web or mobile client.

## T3-managed general subagents

General delegation is separate from both provider-native agents and Fetch. An interactive provider
session can inspect the live provider/model catalog, then start a fresh transient worker through
`GeneralSubagentCoordinator`. Omitted routing fields inherit the caller's provider, exact current
model, and model options. The delegating model can instead choose another enabled, installed,
authenticated provider instance, a model advertised by that instance, and one of the reasoning
values advertised by that exact model. This permits task-aware choices such as a specialist security
model without teaching orchestration a fixed mapping from task labels to models.

The selected worker starts with `purpose: "subagent-worker"`, the parent worktree, the parent's
runtime mode, normal interaction mode, and the full provider tool surface. Its provider binding is
transient and generation-fenced; it is never written to provider-session persistence. Runtime events
are projected into the durable parent transcript with `origin: "t3-managed"`, exact provider/model
metadata, progress, and terminal state. On restart, normal orphan-subagent reconciliation settles any
projected worker whose in-memory runtime no longer exists.

Codex, ChatGPT, OpenRouter, OpenAI, Claude, Cursor, Grok, and OpenCode can initiate this flow through
the authenticated internal MCP toolkit. Gemini's direct SDK harness does not expose that toolkit,
so Gemini cannot initiate delegation in this slice; it remains eligible as a selected worker and
performs the delegated coding task through its T3-owned direct tools. General workers cannot ask
hidden user questions, do not spawn nested agents, and are cancelled if their parent turn completes
first.

Worker completion keeps the detailed result in the child transcript and returns a bounded digest
plus a stable result reference to the parent. The parent resolves that reference only when
integration requires the full detail. Tool outputs follow the same reference-first boundary, so
continuation prompts carry digests instead of repeatedly copying a large canonical payload.
Optional tool schemas are registered lazily and loaded only when requested; core tool availability
remains explicit.

Fetch eligibility is another provider-snapshot capability. Providers without `fetchWorkers` do not
appear in the Fetch model picker. The capability owns the recommended planning budget and command
policy for transient exploration workers:

| Driver     | Initial worker budget | Fetch command policy |
| ---------- | --------------------- | -------------------- |
| Codex      | 8                     | Read-only sandbox    |
| ChatGPT    | 8                     | Read-only sandbox    |
| OpenRouter | 8                     | Deny commands        |
| OpenAI     | 8                     | Deny commands        |
| Claude     | 8                     | Deny commands        |
| Cursor     | 8                     | Deny commands        |
| Grok       | 8                     | Deny commands        |
| OpenCode   | 8                     | Deny commands        |
| Gemini     | 8                     | Deny commands        |

The budget is a provider declaration, not an application-wide clamp. A provider or fork may
advertise a larger supported worker count.

## Fetch preflight

Fetch is a T3-managed preflight and does not depend on the main provider's native-subagent tools.
The server persists one atomic `fetchModelSelection` per environment; `null` means Auto. Resolution
prefers a live non-custom Codex Spark model, then Codex Luna with low reasoning, then the configured
text-generation model when Fetch-capable, and finally the first Fetch-capable provider's default or
first model. Manual selections remain exact. Only an Auto-selected Spark model may fall back once to
Luna-low after a typed entitlement, rate-limited, or model-unavailable error before workers start.
Timeouts and unrelated provider failures do not trigger fallback.

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

## OpenCode server ownership and catalog

Each OpenCode provider instance owns one lazy local server for catalog discovery and
text-generation helpers through [`OpenCodeServerOwner.ts`][opencode-server-owner]. Concurrent
borrowers share startup. The server closes 30 seconds after the last borrower releases it, or
when the provider instance closes. A failed or exited process can be started again on the next
use. An externally configured OpenCode server remains externally owned.

The local server and its SDK clients use one resolved password. An explicit provider password
overrides `OPENCODE_SERVER_PASSWORD` in the spawned environment. Without an explicit password,
the client uses the password from the environment that the process inherits. External servers use
only their explicit provider password and never inherit the host's local password.

Every server connection must pass the authenticated `/global/health` check before inventory or
session operations start. The response must contain a valid version at or above 1.14.19. Local
owners cache this result for the lifetime of the spawned process. External actions check once when
they create their server connection, not for each model or SDK request.

Chat adapters keep their own server per thread. They register a thread-specific `t3-code` MCP
connection, while OpenCode stores MCP connections by directory. Sharing these chat servers
without changing MCP routing would let two threads in one directory replace each other's
connection.

OpenCode loads its catalog through the HTTP API when an enabled provider instance starts. The
provider registry keeps the snapshot in memory and persists it in the existing per-instance cache.
Each `subscribeServerConfig` connection refreshes all providers, so a client reconnect reloads the
OpenCode catalog from the current helper. The `serverRefreshProviders` request also refreshes it.
Periodic OpenCode probes remain disabled. OpenCode reads credentials for each inventory request,
but its native configuration files can remain cached for the lifetime of the helper process. The
helper closes 30 seconds after its last inventory or text-generation borrower releases it. A
refresh after that idle period starts a new helper and reads file changes. Repeated refreshes and
active text-generation work can extend process reuse. Changes to the provider configuration or
environment replace the instance and start a new discovery. Changes to unrelated settings only
update snapshot enrichment. Other providers retain their existing refresh policy.

T3 Code does not own an external OpenCode process. Native configuration changes there can require
an external reload or restart before T3 Code's next refresh sees them.

The shared server's idle shutdown does not clear the catalog. Failed discovery keeps the last
known models, slash commands, and skills through the registry's existing merge rules. A successful
empty inventory is authoritative. Existing threads keep their explicit model identifier and
options when catalog metadata is missing; the catalog is not permission to choose a different
model for a thread.

## Model manifest

The model picker's legacy section is driven by `apps/server/src/provider/model-manifest.json`, which
lists the current (non-legacy) model slugs per driver kind. The `ModelManifest` service
(`apps/server/src/provider/ModelManifest.ts`) refreshes that data from the same file on `main` via
raw.githubusercontent.com, so moving a model in or out of the legacy section is a commit, not a
release. Preference order is remote fetch, then the on-disk copy of the last successful fetch (in
the state directory), then the bundled copy. Fetches are TTL-gated, run concurrently with provider
probes, respect the `enableProviderUpdateChecks` setting, and never fail a provider check. The
Codex and Claude drivers apply the classification to every snapshot with `applyModelManifest`;
driver kinds absent from the manifest have no legacy concept.

## Attachment access

The server stores uploaded attachments in its attachment directory, outside the project workspace.
`ProviderService` adds the absolute path of each attachment to the turn text, then passes every
attachment to the provider adapter. Each adapter decides what its provider ingests natively:

- Codex, Claude, Cursor, Grok, and OpenAI send images as native image inputs and skip generic files.
  For these providers, generic files reach the agent only as file paths in the turn text.
- OpenCode sends PNG/JPEG/GIF/WebP images, text files, and PDFs up to 20 MB as native file parts
  with their real mime type. Everything else (ZIP and other binaries, image formats model APIs
  reject, oversized files) falls back to the file path in the turn text, like the other providers.

Claude receives the attachment directory as an allowed additional directory. Codex keeps its
configured sandbox policy, so access depends on that policy and the selected runtime mode. OpenCode
allows all paths in full-access mode and requests approval for directories outside the workspace in
restricted modes. Cursor and Grok use their own provider permission rules.

The server does not copy attachments into a project or bypass provider approval rules. If an agent
cannot read an attachment, the user must approve the access or select a runtime mode that permits it.

Updated attachment schemas tolerate unknown attachment members, but old image-only clients still
cannot decode messages that contain file attachments. Client file-picking rollouts must account for
this limit.

Do not run an old image-only server against state that contains file attachments. Replay decodes
each persisted event before projection. A file-bearing event can make `ProjectionPipeline` bootstrap
and `OrchestrationEngine` startup fail for the entire environment, not only the affected thread.

## How provider work is requested

Clients never call a provider directly. They dispatch orchestration commands over the RPC method
`orchestration.dispatchCommand`, defined with the rest of the orchestration surface in
[`orchestration.ts`][contracts]. The client-dispatchable provider-facing commands are
`thread.turn.start`, `thread.turn.retry`, `thread.turn.interrupt`, `thread.approval.respond`,
`thread.user-input.respond`, `thread.checkpoint.revert`, and `thread.session.stop`, plus the mode
setters `thread.runtime-mode.set` and `thread.interaction-mode.set`.

`thread.turn.retry` references the existing user message and the exact interrupted turn. The
decider accepts it only when that turn has no assistant output, then emits a result-only
`thread.turn-start-requested` event without another `thread.message-sent` event.

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
[chatgpt]: ../../apps/server/src/provider/Drivers/ChatGptDriver.ts
[openrouter]: ../../apps/server/src/provider/Drivers/OpenRouterDriver.ts
[openai]: ../../apps/server/src/provider/Drivers/OpenAiDriver.ts
[claude]: ../../apps/server/src/provider/Drivers/ClaudeDriver.ts
[cursor]: ../../apps/server/src/provider/Drivers/CursorDriver.ts
[grok]: ../../apps/server/src/provider/Drivers/GrokDriver.ts
[opencode]: ../../apps/server/src/provider/Drivers/OpenCodeDriver.ts
[gemini]: ../../apps/server/src/provider/Drivers/GeminiDriver.ts
[opencode-server-owner]: ../../apps/server/src/provider/OpenCodeServerOwner.ts
[adapter]: ../../apps/server/src/provider/Services/ProviderAdapter.ts
[instances]: ../../apps/server/src/provider/Services/ProviderInstanceRegistry.ts
[registry]: ../../apps/server/src/provider/Services/ProviderAdapterRegistry.ts
[service]: ../../apps/server/src/provider/Layers/ProviderService.ts
[history-sync]: ../../apps/server/src/provider/Services/ProviderHistorySync.ts
[harness-sync]: ../../apps/server/src/harnessChatSync.ts
[contracts]: ../../packages/contracts/src/orchestration.ts
[worker]: ../../packages/shared/src/DrainableWorker.ts
[ingest]: ../../apps/server/src/orchestration/Layers/ProviderRuntimeIngestion.ts
[cmd]: ../../apps/server/src/orchestration/Layers/ProviderCommandReactor.ts
[checkpoint]: ../../apps/server/src/orchestration/Layers/CheckpointReactor.ts
