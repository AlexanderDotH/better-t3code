# MCP configuration and runtime status

User MCP configuration is durable environment state. MCP connection health is ephemeral provider
session state. T3 Code deliberately keeps those models separate so a persisted `connected` value
cannot survive a provider exit or server restart and become a lie.

## Configuration routing

Each MCP definition keeps one shared transport and secret configuration plus provider-instance
routing. Missing routing decodes as `all`, preserving definitions written by older servers. An
explicit selection stores provider instance IDs, not driver names, so two accounts backed by the
same driver can receive different server sets. `all` includes provider instances created later;
`selected` does not. An update that omits routing preserves the stored value, which prevents an old
client from erasing a newer provider selection.

The effective list is resolved from four conditions:

1. the definition's master `enabled` flag;
2. global or project scope;
3. provider-instance routing; and
4. the adapter's MCP delivery capability.

Adapters receive only the resolved list. Provider-specific status is not inferred from this list:
successful configuration delivery proves neither authentication nor tool discovery.

MCP catalog mutations use the settings service's transactional modifier. Read, transform,
validation, secret persistence, write, cache replacement, and publication run under the same
environment settings semaphore. Mutations address definitions by stable server ID against the
latest catalog, so concurrent clients changing different definitions cannot overwrite one another
with an earlier full-array read.

## Live configuration reconciliation

`McpConfigurationReconciler` consumes every catalog transition, including create, update, delete,
master enablement, provider assignment, Cursor and agent-source imports, replace imports, and
external `settings.json` changes. It computes affected provider instances and the union of previous
and new project scopes, then reconciles every matching active runtime against the complete desired
managed-server set.

Each transition receives a configuration generation. Before applying and before publishing a
result, the reconciler verifies that generation is still current. Superseded work cannot overwrite
newer configuration. Each adapter is invoked at most once per affected runtime and its full reported
managed set is verified. Results are `applied`, `pending-next-session`, `unsupported`, or a
sanitized `failed`; unconfirmed additions and removals carry configuration drift. No reconciliation
path restarts a provider session.

## Ephemeral registry

`McpRuntimeRegistry` owns normalized live snapshots. Entries are fenced by environment, provider
instance, thread, runtime session, and native server key. A late event from a replaced runtime
session is ignored.

Every runtime subscription begins with one authoritative snapshot. Set-wide transitions such as
refresh replacement, stale-all, session exit, runtime-generation replacement, and multi-server
drift publish one complete snapshot with one new revision. A delta is reserved for a genuine
single-server mutation such as lazy detail enrichment. This prevents several updates with the same
revision from being partially folded by a client.

Provider startup events update the registry push-first where available. Explicit refresh remains
single-flight per exact runtime so concurrent readers share one provider query. Provider events
arriving during that query schedule at most one trailing refresh; they do not create one process or
query per event. There is no prompt-time catalog reload, continuous polling, or independent MCP
health-check client.

A failed refresh marks the previous snapshot stale. A session exit invalidates its connected
entries. Neither state is written to orchestration projections or the event store.

The provider-context stream publishes an initial provider-scoped context snapshot followed by
versioned start, replacement, and end changes. The registry keeps all active contexts plus at most
20 most recently updated inactive contexts per provider and expires inactive contexts after 24
hours. This is bounded observation state, not durable session history.

## Shared client projection

`packages/client-runtime` owns the accumulated runtime projection used by both MCP Settings and the
workspace card. It is keyed by environment, provider instance, thread, and exact runtime session.
A late consumer receives the accumulated authoritative snapshot rather than the last raw delta.
Wrong selectors and stale revisions are rejected. An equal-revision authoritative snapshot may
replace state only when its observation time is not older; a single-server delta must have a
strictly newer revision. A reconnect snapshot replaces the accumulated state.

Provider-context lifecycle has a separate provider-scoped projection. Consumers release inactive
subscriptions after a short idle TTL. Configuration mutations serialize per environment, while
runtime actions serialize per exact runtime and server target. Detail requests include the complete
selector plus provider-native key and are cancelled or ignored after environment, project,
provider, thread, or session changes. Settings and the card therefore share one reducer and cannot
diverge through different unary refresh paths.

## Adapter boundary

Adapters expose optional, granular MCP runtime capabilities:

- inspect status and inventory;
- apply a resolved live configuration;
- refresh or reconnect a server; and
- begin provider-owned authorization.

The registry and clients consume normalized states rather than branching on driver names. Cursor
can therefore report that status is unavailable, Grok can report user MCP as unsupported, and a
fork-specific adapter can add capabilities without changing orchestration.

Live configuration changes are durable-first. The mutation response may include provider-specific
live-apply results. An `applied` result requires a subsequent status snapshot that confirms the
complete intended set; otherwise the result is pending for the next session, unsupported, or a
sanitized failure.

## Inventory and identity

Runtime rows distinguish:

- `t3-managed`: a durable user definition with a stable MCP server ID;
- `provider-native`: a runtime-owned server discovered by the provider; and
- `t3-built-in`: the authenticated internal server described in
  [Internal provider MCP](./internal-mcp.md).

The built-in server is read-only and excluded from user health totals. Native keys are correlated
to stable T3 IDs where possible; display names are never assumed unique. Full tool input/output
schemas are not sent through routine snapshots. Details expose only bounded names, descriptions,
safe annotations, server metadata, and resource counts.

## Workspace capability and loading

An environment advertising `mcpWorkspaceVersion: 1` supports the context stream and workspace-card
runtime management. The card remains present against an older server, but uses configuration counts
already available to the client, performs no new runtime requests, and renders an upgrade-required
configuration-only expanded state. Existing RPC names and exact-session runtime actions remain
compatible, and missing live-apply results decode as an empty collection.

Only the exact runtime stream required for truthful compact statistics remains active while MCP is
registered. Provider context lists load while MCP is active or expanded. Tools, resources,
templates, versions, and sanitized issues load only after the corresponding disclosure. Health is
not cached in SQLite or persisted offline.

## Security and remote behavior

All runtime RPCs remain scoped to the environment that owns the thread. Read operations require
orchestration-read authorization; configuration and runtime mutations require orchestration-operate
authorization. Status and error payloads are sanitized before entering the registry: environment
variables, headers, bearer tokens, OAuth state, tool inputs, and full schemas cannot cross the
client boundary.

An authorization action may return a provider-generated URL. The client opens that URL, while the
provider runtime retains tokens and callback state. When the provider requires a host-local callback
that is not reachable through the current connection mode, the capability is reported as unavailable
and the UI directs the user to complete authorization on the host rather than offering a broken
button.

Old servers remain usable during version skew. A new client can fall back to configuration-only
rendering when runtime RPCs are unavailable, but it must not present a configured count as live
health. The native mobile client keeps its existing MCP UI and does not render the workspace card.
