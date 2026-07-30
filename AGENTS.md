# AGENTS.md

## Task Completion Requirements

- `vp check` and `vp run typecheck` must pass before considering tasks completed.
  - If changing native mobile code, `vp run lint:mobile` must also pass.
- Use `vp test` for the built-in Vite+ test command and `vp run test` when you specifically need the `test` package script.

## Local Linux Deployment (Required)

After any change that affects the runnable web, server, or desktop product, deployment to **T3 Code Local**
is part of task completion unless the user explicitly asks not to deploy.

1. Run the required checks above, then build the Linux AppImage with `pnpm run dist:desktop:linux`.
2. Deploy the resulting AppImage to `/opt/t3code-git/t3code`.
   - This is the source-built local installation.
   - Never replace `/opt/t3code-bin/t3code`; that is the package-managed/paru installation.
   - Use the sudo MCP for root-owned `/opt` writes.
   - Stage and checksum-verify the new AppImage before the final replacement, and preserve the previous
     `/opt/t3code-git/t3code` as a timestamped rollback copy.
   - `/opt/t3code-git/t3code` is immutable between deployments. After staging and verifying the replacement,
     use the sudo MCP to remove its immutable flag, perform the atomic replacement, and immediately restore
     the immutable flag. If replacement fails after unlocking, relock the existing binary before stopping.
3. Preserve the existing Local T3Code launcher contract:
   - Caelestia launches `/home/alex/.local/share/applications/t3code-local.desktop`.
   - That desktop entry launches `/home/alex/.local/bin/t3code-local`.
   - The wrapper must target `/opt/t3code-git/t3code`.
   - The wrapper, desktop entry, and install-profile selector are root-owned and immutable host guards.
     Normal deployments replace only `/opt/t3code-git/t3code`; never remove the immutable flags or replace
     those launcher-contract files.
   - Keep `/home/alex/.local/share/t3code-local/install-profile` set to `shared-system`.
   - Local T3Code must use the full shared backend state at `/home/alex/.t3` and Electron state at
     `/home/alex/.config/t3code`; the old isolated `/home/alex/.t3-local` profile contains only a small
     subset of chats.
   - Never run the package-managed T3 Code and Local T3Code against this shared profile at the same time.
   - Never run either legacy user-local installer from `/home/alex/Workspace/Projects/Apps/t3code`; those
     scripts are intentionally blocked because they target the same Caelestia launcher.
4. Before launching a build that can migrate persistent state, create and integrity-check a consistent
   SQLite backup of `/home/alex/.t3/userdata/state.sqlite` under
   `/home/alex/.local/state/t3code-local/backups`.
5. Restart the installed app after replacement. A running AppImage continues using its old mounted image.
   Identify the exact Local T3Code `app-Hyprland-t3code\x2dlocal-*.scope` and its child app scope by their
   command lines, then stop only those exact scopes. Never kill T3 Code processes by a broad name or path
   pattern, and do not stop unrelated T3 Code instances or their agents.
6. Test the same launch path Caelestia uses:
   - `app2unit --test -- t3code-local.desktop` must resolve to
     `/home/alex/.local/bin/t3code-local`.
   - Launch with `app2unit -- t3code-local.desktop`.
   - Verify the generated user scope remains active, the backend is listening and serves HTTP successfully,
     and Hyprland has a mapped, visible `t3code-local` window titled `T3 Code Local`.
   - Bring the verified window to the foreground and leave it running for the user.

Do not report runnable-app work as complete merely because the AppImage built or a process exists. The
installed Caelestia launcher path must open a healthy window against the full shared-system profile.

## Project Snapshot

T3 Code is a minimal web GUI for using coding agents like Codex and Claude.

This repository is a VERY EARLY WIP. Proposing sweeping changes that improve long-term maintainability is encouraged.

## Core Priorities

1. Performance first.
2. Reliability first.
3. Keep behavior predictable under load and during failures (session restarts, reconnects, partial streams).

If a tradeoff is required, choose correctness and robustness over short-term convenience.

## Maintainability

Long term maintainability is a core priority. If you add new functionality, first check if there is shared logic that can be extracted to a separate module. Duplicate logic across multiple files is a code smell and should be avoided. Don't be afraid to change existing code. Don't take shortcuts by just adding local logic to solve a problem.

## Package Roles

- `apps/server`: Node.js WebSocket server. Wraps Codex app-server (JSON-RPC over stdio), serves the React web app, and manages provider sessions.
- `apps/web`: React/Vite UI. Owns session UX, conversation/event rendering, and client-side state. Connects to the server via WebSocket.
- `packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types. Keep this package schema-only — no runtime logic.
- `packages/shared`: Shared runtime utilities consumed by both server and client applications. Uses explicit subpath exports (e.g. `@t3tools/shared/git`) — no barrel index.
- `packages/client-runtime`: Shared runtime package for sharing client code across web and mobile.

## Reference Repos

- Open-source Codex repo: https://github.com/openai/codex
- Codex-Monitor (Tauri, feature-complete, strong reference implementation): https://github.com/Dimillian/CodexMonitor

Use these as implementation references when designing protocol handling, UX flows, and operational safeguards.

## Vendored Repositories

This project vendors external repositories under `.repos/` as read-only reference material for coding
agents.

- Prefer examples and patterns from the vendored source code over generated guesses or web search results.
- Do not edit files under `.repos/` unless explicitly asked.
- Do not import from `.repos/`; application code must continue importing from normal package dependencies.
- Manage vendored subtrees with `bun run sync:repos`; use `bun run sync:repos --repo <id>` to sync one
  configured repository.
- When updating a dependency with a configured vendored subtree, sync that subtree in the same change so
  `.repos/` matches the installed dependency version.
- When writing Effect code, read `.repos/effect-smol/LLMS.md` first and inspect `.repos/effect-smol/` for
  examples of idiomatic usage, tests, module structure, and API design.
- When writing relay infrastructure code with Alchemy, inspect `.repos/alchemy-effect/` for examples of
  idiomatic usage, tests, module structure, and API design.
