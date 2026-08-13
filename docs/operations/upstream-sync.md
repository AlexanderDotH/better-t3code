# Better T3 Code upstream synchronization record

This document is the durable audit for the August 10, 2026 consolidation and upstream merge. It
records which histories were inspected, where their behavior survives, and which fork behaviors
must remain intact when conflicts are resolved. It is not permission to reuse the `ours` strategy
for upstream code: custom behavior is authoritative, while current upstream structure, APIs,
security fixes, rollback behavior, and performance work are the implementation foundation.

## Recorded baseline

| Item                    | Recorded value                                                                          |
| ----------------------- | --------------------------------------------------------------------------------------- |
| Canonical checkout      | `/home/alex/Workspace/Projects/Apps/better-t3code`                                      |
| Original custom tip     | `289a0b27c7dbab54f5c094349dc634078f9f379f` (`feature/mcp-workspace-git-workbench`)      |
| Consolidated custom tip | `154ac49a49c04b432affa50022ed0cbc60b03466` (`integration/consolidated-custom-20260810`) |
| Pending-work snapshot   | `f687f37ab76485f1f16bb359bf6445a2458757b2` (`backup/pre-upstream-worktree-20260810`)    |
| Recorded upstream tip   | `a7b0366cbe1e9eabc9e37eb079a38f6b6691f999` (`upstream/main`, final pre-gate freeze)     |
| Upstream merge commit   | `e9b96c9be411b06e7454e9020101b26899365a82`                                              |
| Original `origin/main`  | `4dae4c6903cbf5733ceaa36ecfc731b9e369ee26`                                              |
| Merge base              | `50871eb5de641ffd41b1f9d0151668982d276393`                                              |
| Divergence at freeze    | 23 custom-only commits and 223 upstream-only commits                                    |
| Publication target      | Fast-forward `origin/main`; never force-push                                            |
| Rescue directory        | `/home/alex/.local/state/t3code-repo-rescue/20260810-upstream-sync`                     |

The previously planned upstream SHA `d440442db` moved before execution. The repository was fetched
again and the initial integration was repeated against `78f462c4e`, which brought the
upstream-only count from 214 to 216. The mandatory pre-packaging freeze then found seven additional
upstream commits. They were merged normally from `a7b0366cb`, all affected focused and Chromium
tests were repeated, and the final recorded upstream-only count is 223.

## Recovery evidence

The rescue directory is outside the repository and is retained independently of all branches. Its
payload includes:

- `all-refs.bundle`, verified by `git bundle verify`;
- exact ref, branch, remote, status, history, configuration, and worktree manifests;
- a full-index binary patch for all tracked working-tree changes and a separate staged patch;
- a gzip tar archive and NUL-safe manifest for every untracked file; and
- `SHA256SUMS` covering every payload artifact.

Independent verification established all of the following at the freeze point:

- all 18 payload checksums passed;
- the bundle advertised exactly the 955 captured refs, including 168
  `refs/t3/checkpoints/*` refs;
- the branch manifest captured 786 local and remote-tracking refs;
- the tracked patch contained 120 files, 6,106 insertions, and 532 deletions;
- the staged patch was empty, matching the recorded index state;
- the archive contained all 29 untracked files, including
  `.cursor/hooks/state/continual-learning.json`; and
- the untracked archive member list and extracted content matched the frozen source files.

The generated Cursor state file is rescue-only. It is absent from product commits, and
`.cursor/hooks/state/` is ignored by [`.gitignore`](../../.gitignore).

The immutable worktree snapshot has parent `289a0b27c`, changes exactly 149 product paths, and has
tree `6b62f80e8b5f1a89d829928630354523d04d6a87`. The seven consolidated commits produce that exact
same tree:

| Commit                                     | Consolidated behavior                                                                                                            | Representative regression coverage                                                                                                                                                                                                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `6843d5db20fbe7a4863edfdd9de8badaaac7e425` | Provider/model switching, OpenCode/Gemini selection, runtime rebinding, transcript handoff, and provider-specific runtime state  | [provider transcript handoff](../../apps/server/src/orchestration/providerTranscriptHandoff.test.ts), [OpenCode adapter](../../apps/server/src/provider/Layers/OpenCodeAdapter.test.ts), and [provider service](../../apps/server/src/provider/Layers/ProviderService.test.ts)     |
| `083db0bed8c51e532fe3da1fd78cfa025f92e33e` | Provider-selectable repository Fetch, fenced workers, cancellation, partial failures, settings, and migration 043                | [Fetch planner](../../apps/server/src/fetch/FetchExplorationPlanner.test.ts), [Fetch coordinator](../../apps/server/src/fetch/FetchWorkerCoordinator.test.ts), and [migration 043](../../apps/server/src/persistence/Migrations/043_ProjectionThreadSubagentFetchMetadata.test.ts) |
| `c032acf03bb3e65c03444eb7a9813008cb15a8d3` | Cross-thread project-agent claims, inboxes, MCP tools, projections, wake-up behavior, and migration 044                          | [coordination contracts](../../packages/contracts/src/projectAgentCoordination.test.ts), [claim rules](../../apps/server/src/projectAgent/claimRules.test.ts), and [migration 044](../../apps/server/src/persistence/Migrations/044_ProjectAgentCoordination.test.ts)              |
| `21cfc1fcd83d2be5facfc344cd625cb08b9226e9` | Durable subagent lifecycle, chronological transcripts, mobile activity, lifecycle pills, History, and centered transcript dialog | [client reducer](../../packages/client-runtime/src/state/subagentReducer.test.ts), [lifecycle stack](../../apps/web/src/components/subagents/useSubagentLifecycleStack.test.ts), and [mobile activity](../../apps/mobile/src/lib/threadActivity.test.ts)                           |
| `ae31a5bec1e0895ab9743ce2f36e03c9be38c72f` | Workspace deck layout/motion and Git workbench activity indicators                                                               | [workspace motion](../../apps/web/src/components/workspace-deck/WorkspaceCardDeck.motion.test.ts) and [Git changes indicator](../../apps/web/src/components/git-workbench/GitWorkspaceChangesIndicator.test.tsx)                                                                   |
| `a106ce2ec7b93d5c56668fd419f6de9dde35e87d` | Node/pnpm-compatible local desktop packaging and TypeScript script execution                                                     | [desktop build artifact tests](../../scripts/build-desktop-artifact.test.ts) and [local installer tests](../../apps/server/src/installT3CodeLocalLinux.test.ts)                                                                                                                    |
| `154ac49a49c04b432affa50022ed0cbc60b03466` | Current Better T3 Code provider, Fetch, coordination, MCP, and chat-control documentation                                        | [documentation index](../README.md)                                                                                                                                                                                                                                                |

The equality check is exact, not a path-count approximation:

```text
154ac49a49c04b432affa50022ed0cbc60b03466^{tree}
f687f37ab76485f1f16bb359bf6445a2458757b2^{tree}
= 6b62f80e8b5f1a89d829928630354523d04d6a87
```

## Legacy branch inventory

The following tips were already ancestors of the original custom tip and require no synthetic
parent:

| Ref                                                                     | Tip                                        |
| ----------------------------------------------------------------------- | ------------------------------------------ |
| `main`, `origin/main`                                                   | `4dae4c6903cbf5733ceaa36ecfc731b9e369ee26` |
| `integration/consolidate-all-custom-work-20260731`, matching origin ref | `ead091df8ee7a4d7161e4135378f7d0492654f92` |
| `origin/integration/upstream-20260730`                                  | `932adadaafce02a73eebe9c45e5017de7af9925b` |
| `feature/mcp-workspace-git-workbench`, matching origin ref              | `289a0b27c7dbab54f5c094349dc634078f9f379f` |

The remaining legacy histories reduce to three archival tips plus the new immutable worktree
snapshot:

| Top-level tip                                                                                                        | Histories covered                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `backup/mixed-better-20260731` / `origin/backup/mixed-better-20260731` at `0c92234a1469ec0144d60b1bb5c6e119f992d47e` | The mixed Better T3 Code rescue snapshot                                                                                                 |
| `origin/backup/mixed-t3code-20260731` at `467ec4d2e9adee8033f094af6bce30ea43f511d0`                                  | `origin/provider-conversation-workflows` at `d1876245`, merge `d208ca33`, and `origin/backup/pre-upstream-replay-20260730` at `58911c0f` |
| `origin/backup/mixed-upstream-integration-20260731` at `1f546cdf4098227b57bd86b2c39b4df7f485b413`                    | Its already-contained parent `932adadaa` and the dirty integration snapshot                                                              |
| `backup/pre-upstream-worktree-20260810`, matching origin ref, at `f687f37ab76485f1f16bb359bf6445a2458757b2`          | Every initially uncommitted product change                                                                                               |

### Unique legacy commit audit

#### Provider and conversation lineage

`d187624542d01a46faa520949996906d2e41715a` has the same subject and author timestamp as its
newer-base replay `e69a557394e08b40f349bf97ad3a00ffb9b94957`. Of the old commit's 232 changed
paths, 229 overlap the replay. It is not patch-equivalent because the base, contracts, and provider
architecture evolved.

Its surviving behavior is represented by `e69a55739`, the provider restoration commits
`c3431e49d` and `d4272cca1`, the native-driver convergence commit `7479ada80`, and the consolidated
provider commit `6843d5db2`. Coverage includes provider transcript handoff, provider discovery and
selection, every native adapter, MCP configuration, AssemblyAI, chat import/export, and Older
Projects.

The old standalone Cursor SDK, Gemini, Hyperagent, and OpenAI-compatible driver experiments are not
part of the surviving feature contract. Commit `7479ada80bf9324d43621e7460d86aeffde2bf84`
deliberately converged on T3 Code's native Codex, Claude, Cursor, Grok, and OpenCode drivers. Gemini
selection survives through OpenCode rather than by restoring the obsolete standalone driver.

`d208ca33a85aa1efaad828cead1c2ccce6b84aed` is the merge record for that old provider
lineage. `git diff-tree --cc` reports zero combined-diff paths, so it has no independent conflict
resolution or behavior to port.

#### Project speech scanning

`58911c0f5ea35f326a2b464962eb3fedf2a589dc` is semantically replayed as
`932adadaafce02a73eebe9c45e5017de7af9925b`. The commits have the same subject and timestamp,
the same eight changed paths, and the same 341-insertion/45-deletion shape. Context evolved in
`server.ts`, `server.test.ts`, and `ProjectSpeechProfiles.test.ts`; the bounded scanner itself and
its regression suite survive in
[ProjectSpeechWorkspaceScanner.test.ts](../../apps/server/src/speech/ProjectSpeechWorkspaceScanner.test.ts).

#### Mixed T3 Code snapshot

`467ec4d2e9adee8033f094af6bce30ea43f511d0` changed 124 paths, of which 118 remain in the
consolidated tree. Its six absent paths are accounted for:

- the legacy migration 034 implementation and test were replayed as migrations 037 and 041, with
  compatibility handling in migrations 038 and 040; and
- `ManagedProcessTree` plus the three `ProviderTurnAbortCoordinator` files were superseded by the
  orchestration-level [TurnAbortCoordinator](../../apps/server/src/orchestration/Layers/TurnAbortCoordinator.ts),
  provider abort-target fencing, and adapter-owned exact-runtime force stop.

Regression protection lives in
[TurnAbortCoordinator.test.ts](../../apps/server/src/orchestration/Layers/TurnAbortCoordinator.test.ts),
[threadAbort.test.ts](../../packages/client-runtime/src/state/threadAbort.test.ts), provider service
and adapter tests, and the migration compatibility suites.

#### Mixed Better T3 Code snapshot

`0c92234a1469ec0144d60b1bb5c6e119f992d47e` changed 219 paths, of which 175 remain. All 44
absent paths are classified:

- mobile abort presentation moved to shared client-runtime state and the web composer tests;
- its full-stack force-abort fixture is replaced by deterministic TurnAbortCoordinator,
  ProviderService, and per-adapter exact-runtime fencing tests; and
- the remaining 42 paths are the obsolete standalone provider implementations removed by
  `7479ada80` in favor of the five native drivers.

The required behavior remains cooperative interruption, an exact five-second escalation, immediate
second-click force stop, runtime-generation fencing, and retained chat history. Those semantics are
not waived by the removal of the old fixture or driver paths.

#### Dirty upstream-integration snapshot

`1f546cdf4098227b57bd86b2c39b4df7f485b413` has the same parent and the exact same tree
`a9007bb4baaefc37f54bb9ceef6df8d3c52ae09b` as already-contained
`ebffa9e6ac6467c0a9115247fe3668ccbed190a8`; `git cherry` also marks it patch-equivalent.
It therefore contains no unmatched product behavior.

Its four later-absent popover/right-panel paths were intentionally replaced by
`5b1781e907ca59e0a86cb24e28ad534954bfc138` and the subsequent History fix
`91d189944d71218de139144fd2e07526a6ee613e`. Their behavior survives in the stacked lifecycle UI,
centered transcript dialog, and History coverage such as
[ChatAgentStack.test.tsx](../../apps/web/src/components/ChatAgentStack.test.tsx) and
[SubagentTranscriptDialog.test.tsx](../../apps/web/src/components/SubagentTranscriptDialog.test.tsx).

## Ancestry-only closure

Directly merging archival snapshot trees would reintroduce obsolete implementations and was
simulated to cause between 27 and 147 conflicts. After the semantic audit and regression gates, a
single documented `ours`-strategy merge records that every archival history was considered while
leaving the audited product tree unchanged:

```bash
git merge --no-ff --no-commit -s ours \
  backup/mixed-better-20260731 \
  origin/backup/mixed-t3code-20260731 \
  origin/backup/mixed-upstream-integration-20260731 \
  backup/pre-upstream-worktree-20260810
```

Before committing, `git diff --cached --exit-code` must report no tree change. After committing, the
merge tree must equal its first-parent tree, and `git merge-base --is-ancestor <tip> HEAD` must pass
for every local and `origin/*` branch tip recorded above.

This is the only approved use of the `ours` strategy in this synchronization. The upstream merge is
an ordinary `git merge --no-ff --no-commit upstream/main`; it must not use `-X ours`, `-X theirs`,
wholesale checkout resolutions, a rebase, or a force-push.

Hidden operational refs—including `refs/t3/checkpoints/*` and any Git-workbench undo or recovery
refs—are preserved in the verified bundle but are not product branches. They must not be merged to
make an ancestry assertion pass.

## Non-negotiable fork feature contract

Every upstream conflict and later refactor must preserve these behaviors:

- Provider/model switching hands off the complete transcript and rebinds the runtime, including
  OpenCode with Gemini models.
- Codex, Claude, Cursor, Grok, and OpenCode remain supported. An unknown persisted provider driver
  remains inspectable instead of making historical threads undecodable.
- Repository Fetch remains configurable across providers and uses dynamically created, read-only,
  fenced workers with bounded concurrency, cancellation, and partial-failure reporting.
- Parallel plan implementation continues to use provider-native subagents.
- Subagent lifecycle is durable across replay and reconnect. Individual pills remain stacked and
  layout-aware, completed pills stay green for 30 seconds before becoming historical, History stays
  reachable, and transcripts remain chronological in a centered dialog.
- Cancellation first cooperates, escalates against the exact runtime after five seconds, force-stops
  immediately on a second click, fences replacement runtimes, and retains chat history.
- MCP management, provider-specific runtime status, skills, `workspace_context`, and project-agent
  coordination remain supported.
- AssemblyAI dictation retains a live waveform, terminology profiles, and optional English output.
- Full transcript export and local sibling-install chat import remain available.
- Git workbench typed operations, queued operations, recovery refs, workspace deck behavior, Git
  change indicators, and selected-folder clone destinations remain intact.
- Older Projects uses an exact seven-day boundary and attention-aware activity, adapted to
  upstream's current project-grouping model.
- Fast mode, automatic runtime mode, prompt improvement, and reasoning recommendations remain
  available.
- Outbound PostHog product analytics remain removed. Local resource diagnostics and telemetry stay
  available.
- Web, desktop, and mobile clients continue to work across local, remote, relay, and tunnel
  connections, including mixed-version connections where supported.

### Additive public interfaces

The merge must preserve the following fork interfaces while adopting additive upstream fields:

- `ServerProvider.nativeSubagents` and `ServerProvider.fetchWorkers`;
- persisted `ServerSettings.fetchModelSelection`, where `null` means Auto;
- client transport `fetchMode: "repository-exploration"`, with provider, model, and worker count
  resolved by the server;
- existing subagent origin/status metadata and `t3-fetch` provenance;
- Git workbench contracts and typed operations;
- authenticated MCP tools `project_agent_list`, `project_agent_claim`, `project_agent_send`, and
  `project_agent_inbox`; and
- claim, lease, message, peer, inbox, and typed-error contracts in
  [projectAgentCoordination.ts](../../packages/contracts/src/projectAgentCoordination.ts).

New contract fields require decoding defaults so older web/mobile clients and mixed-version remote
connections keep working. This synchronization introduces no intentional breaking wire change.

### Migration identity

Migration IDs 1 through 44 are immutable because released fork databases may already contain those
ledger entries. Upstream schema work that originally occupied colliding IDs is replayed after the
fork ledger:

| ID  | Migration                                             |
| --- | ----------------------------------------------------- |
| 045 | `ForkSchemaConvergence`                               |
| 046 | `ProjectionThreadsPinnedCompatibility`                |
| 047 | `ProjectionTurnsKeysetIndexCompatibility`             |
| 048 | `ProjectionThreadsPinOrderKeyCompatibility`           |
| 049 | `ProjectionProjectsDefaultThreadEnvModeCompatibility` |
| 050 | `ProjectionProjectFaviconPathCompatibility`           |

If upstream adds migrations before the final merge, 1-44 remain unchanged, fork schema convergence
stays first, and every colliding upstream migration is replayed under consecutive new IDs in its
original order. Migration gates cover fresh databases, the fork ledger through 44, upstream through
40, historical fork 33/34 collisions, repeated execution, schema equivalence, and
`PRAGMA integrity_check`. Real data is tested only through a disposable `VACUUM INTO` copy; the live
database is never opened read-write.

## Upstream conflict-resolution rules

Resolve in dependency order: contracts/settings/RPCs, persistence and migrations, providers and
orchestration, MCP/Fetch/coordination/Git workbench, client-runtime, web, mobile/desktop, then docs,
scripts, manifests, and generated files.

The following structural decisions are explicit:

- Port Older Projects into upstream `Sidebar`, `LegacySidebar`, and `sidebarProjectGrouping`; do not
  restore deleted `SidebarV2.tsx`.
- Move architecture material into upstream's `docs/internals/` organization; do not revive deleted
  `docs/architecture/*` paths merely to avoid adapting content.
- Build Git workbench on upstream's current VCS and source-control services rather than duplicating
  them.
- Use upstream's newest provider and Codex collaboration plumbing while retaining the fork's
  provider-neutral lifecycle, Fetch, MCP, handoff, and force-stop semantics.
- Retain upstream update rollback, security, correctness, and performance fixes.
- Remove upstream outbound `AnalyticsService` product analytics again while preserving local
  resource telemetry.
- Run fork CI on GitHub-hosted `ubuntu-24.04` and `macos-26` workers because the fork does not have
  access to upstream's organization-scoped Blacksmith runners. Reserve 20 minutes for the full Test
  job because the complete server matrix exceeds the former 10-minute limit on the hosted Linux
  worker even while tests continue to pass.
- Regenerate `routeTree.gen.ts`, dependency metadata, and `pnpm-lock.yaml`; never hand-merge
  generated output.
- Preserve the machine-safety rules in [`AGENTS.md`](../../AGENTS.md): never manage a running T3 Code
  process, never mutate live T3 home state, never modify either `/opt` installation, and refresh only
  the permitted user-local installation after verification.

Immediately before packaging, compare the fetched `upstream/main` to the live remote again. Any new
delta is merged normally and causes affected focused tests, the full Chromium project, and all
CI-equivalent gates to run again. Promotion is complete only when `origin/main` equals the validated
commit, the recorded upstream commit is a merge parent, every known custom branch tip is an
ancestor, the worktree is clean, CI is green, and the installed user-local AppImage hash matches the
built artifact without restarting the running application.

## August 12, 2026 synchronization

This synchronization started from `integration/upstream-20260810` at
`ea5c9472e9bc430bf6a52c542c38a5b8ebaf1d4f`. At that point the fork's published `main` was
`8288b6e78c8c0a6f8ca44c2b9ab25879d8b212c7`, the previous upstream integration point was
`a7b0366cbe1e9eabc9e37eb079a38f6b6691f999`, and the live comparison contained 52 fork-side
commits and 41 upstream-only commits.

Before staging any work, the dirty checkout was captured under
`/home/alex/.local/state/t3code-repo-rescue/2026-08-12-clean-fork`. The verified rescue contains an
all-refs bundle, tracked binary and staged patches, a NUL-safe manifest and gzip archive for the
five untracked files, repository-state manifests, and SHA-256 checksums. A disposable clone restored
the tracked and untracked work successfully. The rescue directory is retained permanently.

The three initially uncommitted feature slices survive as separate commits:

| Commit                                     | Preserved behavior                                       |
| ------------------------------------------ | -------------------------------------------------------- |
| `aa15c27aaa7f1618ed0d011a51ff266b1016462a` | Metadata-only naming attachments                         |
| `a3ebea155aeda5ae288af9c22e9671c29b517eb3` | Strictly serial, shell-free repository Fetch workers     |
| `2b5d44d58122ec250879458486ccb446e9099a2b` | Per-project checkpoint capture controls and migration 51 |

`upstream/main` was initially fetched by its exact destination ref and verified against
`git ls-remote` at `8d24b5131f439d11876815996df41a57d791d3ad`. After the feature commits,
divergence was 55 fork-side commits and 41 upstream-only commits. The initial ordinary
no-fast-forward upstream merge is `eb0652d3e67dd1b2049543955509be0f9d93d1c9`; its second parent
is that initially pinned upstream SHA.

The first pre-PR freeze found one additional upstream commit. The live tip was fetched and verified
at `18918d1c4d0933b565d1336a75cc5069547ff5e6`. Its mobile command-popover glass fix merged without
conflicts as `f8214547d6c12061f03f8fe3361cdae0daddc678`; that merge commit's second parent is the
observed upstream SHA. The delta passed 39 affected mobile thread/composer tests, the mobile
typecheck, targeted lint, and formatting before the merge was recorded.

The first fork PR run also exposed three pull-request workflows that still named upstream's
organization-only Blacksmith runners. `f5d9fe4a38962deacd0d46727f2d8d68e9db63ce` moves the mobile
fingerprint, mobile EAS preview, and web preview jobs to GitHub-hosted `ubuntu-24.04`, matching this
fork's existing CI policy. The required Check, Test, Mobile Native Static Analysis, and Release
Smoke jobs had already passed on the preceding source-identical tree; the complete PR gate is rerun
on the final recorded SHA.

The August 13 final freeze then found nine more upstream commits. The exact fetched and
`git ls-remote`-verified tip `1e59b4c4004ce3c724d09ca0b140ed4523758d1e` is the final pinned
upstream SHA for this synchronization. It adds the expanded pull-request surfaces plus focused web,
relay, theme, and mobile-showcase fixes. The normal merge is
`3b45192de83c28a62db3a9bfdcaa618748b4c358`; its second parent is the final pinned SHA.

That delta produced one textual conflict in `rightPanelStore.ts`. The resolution retains the
fork's strict persisted-surface validation, removed-Agents migration, and deterministic active-tab
fallback while adopting upstream's optional environment identity for cross-server pull-request
tabs. Validation covered all 36 changed upstream test files with 1,122 passing tests, 226 additional
fork-sensitive ChatView, subagent, Older Projects, snooze, project-settings, and right-panel tests,
the four affected package typechecks, changed-file lint and formatting, marker and whitespace
checks, and a production web build. This is the formal final freeze; later upstream commits belong
to the next synchronization cycle.

The merge produced ten textual conflicts. They were resolved semantically as follows:

- Mobile `ThreadComposer.tsx` keeps upstream's stabilized editor focus and native iOS settings menu
  while retaining filtered provider selection, parallel plan implementation, fast mode,
  cooperative abort, and exact-runtime force stop.
- `opencodeRuntime.ts` and its parser tests accept slash-containing model identifiers by splitting
  only at the first slash and reject JSON protocol lines, while retaining Gemini-via-OpenCode,
  provider switching, runtime rebinding, MCP state, and existing whitespace compatibility.
- `BranchToolbar.tsx` and `BranchToolbarBranchSelector.tsx` combine upstream's resize-animation
  cleanup with the fork's simplified status, environment/provider controls, card sizing, and Git
  workbench interactions.
- `RightPanelTabs.tsx` keeps upstream's keyboard-aware empty state without restoring the removed
  Agents sidebar; lifecycle pills, History, transcript dialog, Git, and MCP surfaces remain.
- `Sidebar.tsx` combines Copy Thread ID, Shift-click new thread, and persisted shelf state with
  Older Projects, the exact seven-day boundary, layout and project settings, and attention-aware
  ordering.
- `ComposerPrimaryActions.tsx` and its tests retain upstream's theme-aware environment artwork plus
  Fetch, parallel plan implementation, fast mode, reasoning controls, and abort escalation.
- `pnpm-lock.yaml` was regenerated with Node 24.18.1 and pnpm 11.10.0 after resolving package
  manifests; it was not hand-merged.

Migration IDs 1 through 44 remain immutable, compatibility migrations 45 through 50 keep their
existing identity and order, and `051_ProjectionProjectCheckpointsEnabled` is appended with
`NOT NULL DEFAULT 1`. Project-created, project-updated, and snapshot decoding defaults remain
`true`, preserving old events, cached snapshots, old clients, and mixed-version connections.

Focused validation before recording the merge covered 128 naming and Fetch tests, 285 checkpoint
and compatibility tests, 291 upstream-conflict regression tests, all five targeted package
typechecks, lockfile policy validation, conflict-marker and whitespace checks, and a production web
build. The conflict regression set included OpenCode parsing, toolbar/composer/sidebar/right-panel
logic, subagent UI, and affected mobile thread behavior. The remaining promotion gates are run on
the recorded tree before the fork-only pull request is frozen.

The local Git configuration keeps upstream reads available but hard-disables upstream writes:

```text
remote.upstream.url = https://github.com/pingdotgg/t3code.git
remote.upstream.pushurl = disabled://github.com/pingdotgg/t3code.git
remote.pushDefault = origin
```

All pushes name `origin` and their destination ref explicitly. No upstream branch, pull request, or
other upstream state is written. Existing remote archive branches remain intentionally retained;
only fully merged local branches are removed after fork `main` promotion and both CI gates.
