# Better T3 feature registry

The Better T3 settings surface is a versioned compatibility layer over the settings and
capabilities that own each behavior. It is not a second source of truth for provider credentials,
project data, MCP configuration, or source-control operations.

## V1 contract

`BetterT3FeatureDescriptor` gives each control a stable `BetterT3FeatureId`, settings section,
scope, control kind, availability requirements, dependencies, defaults, and compatibility mirrors.
The four scopes have distinct owners:

- `device` is local client state and is not implied to roam.
- `environment` belongs to one T3 server and is persisted in its server settings.
- `synchronized` uses an explicit versioned synchronization record.
- `project` belongs to one project or effective workspace root.

Control kinds are `switch`, `selector`, `action`, `link`, and `status-only`. Selectors and actions
remain in their owning subsystem when that subsystem needs richer validation, authorization, or a
destructive confirmation. The Better T3 page displays their current availability and links to the
owner instead of duplicating the operation.

`BetterT3SettingsV1` contains a version, an initialization provenance, and a forward-compatible
flag record. Unknown flags survive decode, patch, and encode so a newer client can share settings
with an older process without losing data. Feature availability is resolved separately from the
stored preference. A temporarily unavailable capability therefore does not erase the user's
choice.

## Defaults and compatibility mirrors

Clean installations start with Better T3 switches disabled. Existing installations use the
descriptor's `existing` default for behavior that was previously implicit. A persisted explicit
flag always wins over either default.

Compatibility mirrors identify the existing setting, capability, or RPC that owns a feature. A
read-write mirror keeps the V1 flag and the owning legacy field aligned. Read-only and deep-link
mirrors report state without pretending that Better T3 owns the operation. Bootstrap code seeds a
missing V1 flag only when the legacy field was explicitly present; schema defaults must not be
passed as evidence of an existing preference.

Web client settings and Mobile preferences also repair read-write mirrors on every patch after
bootstrap. A legacy-owning page updates the matching V1 flag, while a Better T3 V1 write updates the
legacy alias for older clients. When one patch contains both representations, the explicit V1 flag
wins. Mobile's `legacyThreadListEnabled` and web's `legacySidebarEnabled` therefore stay consistent
with `chat.classicSidebar` across sequential mixed-version writes.

Credential objects are not boolean read-write mirrors. In particular, AssemblyAI credential
presence may inform a one-time migration, but subsequent credential edits do not enable or disable
the `voice.assemblyAi` feature flag. Credential management remains a deep link to its owning page.

Deep Thinking is the reference migration. If
`agentEnhancement.deepThinking.enabled` was explicitly stored and `agent.deepThinking` is absent,
the legacy value seeds the V1 flag. If both exist, the V1 flag wins. Later patches mirror either
single-sided representation to the other, and malformed persisted data is not silently rewritten
as a valid preference.

## Mixed-version locale synchronization

`InterfaceLocaleSyncRecordV1` carries the locale preference, `updatedAt`, and `updateId`. The
server resolves competing updates with last-write-wins ordering: greater `updatedAt` wins, then
lexicographically greater `updateId` breaks a tie. Stale V1 and legacy updates cannot overwrite a
newer record.

English and German can be projected into the legacy `interfaceLanguageSyncRecord` for clients that
do not understand V1. French remains in V1 because the old schema cannot represent it losslessly.
When loading an older settings file, the legacy record seeds a missing V1 record without deleting
either representation.

## Migrations

Migration identities are immutable after publication. Migration 058 converges the fork with the
upstream schema migrations that already occupied the older numbers. Migration 059 creates the
Knowledge Graph derived-data tables. Derived graph rows are isolated by environment, project, and
canonical effective workspace root, so a main checkout and each worktree remain separate scopes.

Knowledge Graph data is rebuildable and is persisted separately from orchestration history. A
development database prune removes graph scopes for discarded projects through foreign-key
cascades and then removes orphan environment queue state. It does not retain semantic work whose
owning project was removed.

## Always-on invariants

Feature switches control optional activation and presentation only. They never disable:

- exact-runtime stop fencing and lifecycle cleanup;
- durable event replay and projection reconciliation;
- contract decoding, schema validation, authorization, or data-integrity checks;
- mixed-version defaults that keep older clients safe;
- secret filtering and bounded source access.

Turning an optional feature off prevents new activation, safely drains or cancels work owned by
that feature, hides unavailable controls, retains stored preferences and derived data unless the
user explicitly clears them, and remains reversible.

The executable contracts live in
[`packages/contracts/src/betterT3.ts`](../../packages/contracts/src/betterT3.ts), locale merge policy
in [`packages/shared/src/serverSettings.ts`](../../packages/shared/src/serverSettings.ts), and
server-side compatibility loading in
[`apps/server/src/serverSettings.ts`](../../apps/server/src/serverSettings.ts).
