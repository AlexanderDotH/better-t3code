# ChatGPT Subscription harness

`chatgpt` is an Early Access provider driver separate from the stable `codex` driver. It uses Codex
app-server only as a short-lived authentication broker; T3 owns the long-lived session, transcript,
tool loop, approvals, MCP integration, subagents, persistence, and resource admission.

OpenAI documents the browser and `chatgptDeviceCode` login methods, logout, account updates, and
ChatGPT rate-limit reads in the [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server).
The [authentication guide](https://learn.chatgpt.com/docs/auth) also recommends device code for
remote or headless environments. The direct ChatGPT subscription Responses transport used after
login is not a documented public app-server or Responses API contract. Treat every wire assumption
in that transport as Early Access and fail closed on drift.

## Boundaries and contracts

- Provider instances are the isolation boundary. Each instance owns its auth home, credential state,
  model catalog, history, continuation, rate-limit projection, and single-flight refresh.
- `server.providerAuthConnect` streams `starting`, browser or device-code challenge, `connected`,
  `failed`, and `cancelled`. `server.providerAuthDisconnect` is unary. Tokens are absent from every
  contract.
- `ServerProvider.auth` advertises supported flows, disconnect capability, account identity, expiry,
  and plan. `ServerProvider.rateLimit` carries only display-safe quota state.
- Local web and desktop use browser login. Mobile, relay, tunnel, SSH, remote, and headless clients use
  device code. Read-only sessions receive status but no auth actions.

## Credential and transport security

Store an instance below `ServerConfig.secretsDir/providers/chatgpt/<instanceId>/codex-home`. On POSIX,
the directories are mode `0700` and `auth.json` is `0600`. Force Codex to file-backed credential
storage so lifecycle and cleanup remain scoped to that directory. Stop the broker on success,
cancellation, failure, and interruption.

The subscription transport uses the injected Effect HTTP client and a per-account connection pool.
Allow only the fixed OpenAI origin set, reject cross-origin redirects, and redact authorization
headers from logs and typed failures. A `401` joins one instance-wide refresh and retries once. A
second `401` marks the instance unauthenticated. Schema drift, a missing live model catalog,
compaction failure, or an unknown terminal event is a provider error; never fall back to Codex,
API-key billing, another account, another model, or stale catalog data.

## T3-native execution

The shared native harness persists compact session metadata and transcripts while keeping at most
eight idle working sets hot. Responses SSE decoding is incremental and strict for text, reasoning,
encrypted reasoning items, parallel function calls, usage, and terminal events. Model slugs, context
windows, and reasoning levels come only from the live account catalog.

T3 exposes workspace reads, bounded writes and shell execution, configured MCP tools, preview tools,
and project-agent coordination under the thread's permission boundary. Enforce at most 90 declared
tools, 1 MiB output per tool, and 64 tool rounds per turn. When an MCP catalog exceeds the direct
definition budget, keep T3's internal tools first and expose the remaining session-local catalog
through bounded search and call gateway tools. Limit breaches after that compaction finish the turn
with an explicit provider error.

The general subagent coordinator maps `list_agents`, `spawn_agent`, `send_message`, `followup_task`,
`wait_agent`, and `interrupt_agent`. A root may own at most 40 direct children. Child sessions keep
stable IDs and transcripts, interrupted children remain available for follow-up, and root completion
or the 30-minute idle TTL cleans them up. Nested spawning is disabled for this provider release.

## Capacity semantics

The server can manage at least 40 ChatGPT sessions per provider instance. This is a lifecycle and
responsiveness guarantee, not guaranteed simultaneous upstream throughput. A provider instance
admits at most 40 active turns; the global resource governor normally admits fewer.

An in-process turn leases `64 MiB + 2 * serialized history + attachments + tool buffer`. Admission is
FIFO and preserves the existing protected core reserve. Under critical pressure, end the largest,
newest admitted in-process turn with a visible resource-protection error and never retry it
automatically. A deterministic 40-session fake-transport soak must prove controllability, FIFO
admission, pressure cancellation, no per-session provider child process, no OOM at a 16-GiB test
budget, and no more than 2 GiB additional server RSS.
