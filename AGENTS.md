# T3 Code

T3 Code is an open source GUI for coding agents. A Node WebSocket server wraps provider CLIs and serves web, desktop, and mobile clients. Keep systems simple, fast, remote-ready, and consistent across surfaces. Prefer the smallest model that makes correct behavior unsurprising.

Architecture and vocabulary live in [the internal overview](docs/internals/overview.md) and [glossary](docs/internals/glossary.md).

## Hard local safety

These rules override general repository guidance on this machine:

- `/Users/alexanderheuschkel/Projects/better-t3code` is the only canonical checkout on this machine. Sibling checkouts and temporary integration worktrees are donor/reference copies only. Carry useful source changes here before publishing or producing an installable artifact.
- Never start, stop, restart, replace, hand off, or otherwise control a T3 Code process from an agent session. This includes installed apps, desktop clients, dev servers, background jobs, delayed restart jobs, and processes owned by another session.
- Never invoke `app2unit`, `systemctl`, or a user-scope handoff to manage T3 Code. Never arrange a delayed command to do so after the agent exits.
- Never kill by pattern: no `pkill -f`, `pgrep | kill`, or killing a PID found from a name, path, or worktree match. Kill only a PID captured when you spawned the process, or a port owner found with `ss -H -ltnp` after confirming `/proc/<pid>/cwd` is this worktree.
- Never open `~/.t3/userdata` read-write, run a server against it, migrate it, clean it, or otherwise mutate it. Read-only inspection and a consistent copy into this checkout's gitignored `.t3` are allowed. Copy in, never symlink or copy back.
- Never set `VITE_HTTP_URL` or `VITE_WS_URL` for development. Dev is single-origin and Vite proxies `/api`, `/ws`, `/oauth`, and `/.well-known`; fixed localhost origins break remote clients.

### Required local artifact refresh

After successfully verifying a source change that affects the shipped application, refresh the currently installed local T3 Code application before reporting completion unless the developer explicitly opts out. Documentation-only and test-only changes are exempt.

On this macOS machine:

1. Build the current checkout for the host architecture with `vp run dist:desktop:dmg`.
2. Mount the generated DMG without opening the app.
3. Replace only `~/Applications/T3 Code (Alpha).app` with the freshly built app bundle, then detach the DMG.
4. Do not start, stop, restart, or otherwise control the running app. The developer restarts it manually when ready; that next launch must use the newly installed build.

- Preserve all user data. Never modify or remove T3 Code data under `~/Library/Application Support`, `~/.t3`, or any other user-data location during the app-bundle refresh.
- Validate the source and destination bundle identifiers before replacement; both must be `com.t3tools.t3code`.
- Stage the new bundle beside the destination and replace the destination atomically where practical, so a failed copy does not leave a partial installation.
- Replacing the app bundle on disk authorizes only the install refresh. It never authorizes process management.

On Linux, run in order:

```bash
scripts/build-and-install-t3code-local-linux.sh --no-install-deps
scripts/install-t3code-local-linux.sh --confirm-install apps/desktop/release/T3Code.AppImage
```

- Preserve the selected install profile. Pass `--profile` only when the developer explicitly requests a profile change.
- Refresh only `~/.local/share/t3code-local`, `~/.local/bin/t3code-local`, and the corresponding user-local desktop entry and icon.
- Never modify `/opt/t3code-git/t3code`, `/opt/t3code-bin/t3code`, package-managed installations, or immutable flags.
- Replacing the AppImage on disk never authorizes process management. The running process keeps its mounted AppImage until the developer restarts it.
- Despite its legacy name, `build-and-install-t3code-local-linux.sh` only builds and verifies. `install-t3code-local-linux.sh` performs the allowed on-disk refresh and must not manage a process.

## Coverage before completion

Before calling frontend or provider-shaped work done, state which of these applied:

- **Entry points:** chat, Settings, command palette, and keybindings.
- **Clients:** local and hosted web, desktop/Electron, and mobile/React Native. Shared client logic belongs in `packages/client-runtime`.
- **Providers:** Codex, Claude, Cursor, Grok, and OpenCode each need an explicit decision, including “not supported.” See [provider architecture](docs/internals/providers.md).
- **Contracts:** wire data is typed in `packages/contracts`; schema changes must be followed through server, web, desktop, and mobile.
- **Reverse states:** provide the way out and the way to observe it, not a one-way action.
- **Connections:** local, remote/relay, and tunnel behavior, including multiple devices and environments. See [connection runtime](docs/internals/connection-runtime.md) and [remote architecture](docs/internals/remote.md).
- **Docs:** user-visible behavior in `docs/user/`, architecture and contributor facts in `docs/internals/`, runbooks in `docs/operations/`, and vocabulary in `docs/internals/glossary.md`.

Performance is a product constraint. Avoid excess WebSocket payloads, expensive list rendering, stale UI state, and continuously repainting animations.

## Repository and development state

- `vp i` installs dependencies. Worktree setup normally runs it.
- Worktree development state belongs in `<worktree>/.t3`; it must outrank ambient `T3CODE_HOME`. An explicit `--home-dir` still wins. See [script behavior](docs/internals/scripts.md).
- Read actual shifted ports from the `[dev-runner]` line.
- Never wire `tailscale serve` manually. For an already developer-owned shared server, hand over the complete `pairingUrl:` value including its token, and never open it yourself. A consumed token can be replaced with `node apps/server/src/bin.ts pair`; startup URLs have admin scopes, while minted URLs have standard scopes.

For realistic test data, snapshot live SQLite state read-only into this worktree. `VACUUM INTO` is safe while the source is open; a plain live `cp` is not. Remove the disposable destination first because `VACUUM INTO` will not overwrite it. Bring `secrets` or `settings.json` only when the test needs them.

```bash
mkdir -p .t3/userdata
rm -f .t3/userdata/state.sqlite*
bun -e "new (require('bun:sqlite').Database)(process.env.HOME + '/.t3/userdata/state.sqlite', { readonly: true }).run(\"VACUUM INTO '.t3/userdata/state.sqlite'\")"
```

## Verification

- Use the smallest meaningful proof: `vp test run <files>`, plus targeted lint or typecheck only for changed scope.
- Never run repository-wide checks such as `vp check`, `vp run -r test`, or `vp run -r typecheck` unless asked. CI owns the full suite.
- Backend behavior changes require focused behavioral tests. Do not add tests that merely mirror implementation or assert static callback/prop wiring.
- Event-sourced asynchronous tests wait for typed receipts and worker drains, never sleeps or polling. A timeout-dependent passing test is wrong.
- Do not use browsers, computer control, or spin up browser sessions without explicit user permission. When requested, the primary agent performs one integrated pass with `test-t3-app` for web or `test-t3-mobile` for mobile after integration; subagents do not launch dev servers.

## Pull requests

- Never create a pull request unless explicitly asked.
- Use a conventional, plain-language title. Explain the problem and fix, then name the model and harness.
- UI changes need uploaded before/after images; motion or timing needs a short video. Do not commit PR-only evidence such as `.github/pr-assets/`.
- Keep one concern per PR. External proposals follow [CONTRIBUTING.md](CONTRIBUTING.md) and belong in Ideas discussions.
- When babysitting, inspect checks and comments newer than the last push, verify findings against source, fix real issues, explain dismissals, stay quiet when nothing changed, and stop only when bots are green on the latest commit.

## Work artifacts and documentation

- Do not commit plans, research notes, transcripts, or agent scratch files. Keep them outside the worktree; `.plans/` is only a gitignored legacy safety net.
- Track active maintainer work in its GitHub issue or project item. A merged PR is the implementation record; close or update its owner instead of preserving another checklist.
- Put durable current architecture, constraints, and decisions in `docs/internals/`. See [work artifacts](docs/internals/work-artifacts.md).

## Architecture and code map

Clients send typed WebSocket requests. The server turns requests into commands, a pure decider emits persisted events, and a projector derives the read model. Provider adapters translate native protocols into orchestration events. Queue-backed reactors perform effects and emit receipts. Turns end with hidden Git-ref checkpoints.

- `apps/server`: WebSocket, orchestration, providers, and checkpointing. Before writing Effect code, read `.repos/effect-smol/LLMS.md`.
- `apps/web`: React/Vite UI. `apps/desktop` wraps it with Electron; `apps/mobile` is React Native; `apps/marketing` is the site.
- `packages/contracts`: Effect/Schema wire contracts and small derived helpers, without heavy runtime logic.
- `packages/shared`: shared runtime utilities with subpath exports and no barrel.
- `packages/client-runtime`: client logic shared by web and mobile.
- `.repos/`: vendored read-only references. Prefer their patterns, never edit or import from them, and use `vpr sync:repos` when bumping the matching dependency.

Keep complexity at adapter boundaries, orchestration pure, and UI simple. Prefer inferred types; do not use `any`. Comments explain how a unit is used, not each line. If a rule conflicts with the task, stop and obtain explicit human approval before breaking it.
