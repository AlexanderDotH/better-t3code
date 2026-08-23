# CI quality gates

> For maintainers. Using T3 Code? See [docs/user](../user/).

[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs these quality gates on pull requests
and pushes to `main`:

- **Check**: `vp check` (format and lint; this repo sets `typeCheck: false` in its lint options),
  then `vpr typecheck` for the workspace type check. The same job
  builds the desktop pipeline (`vp run build:desktop`) and verifies the preload bundle exists and
  still exports its expected symbols.
- **Test**: all non-server package tests run in parallel with a four-package concurrency limit.
- **Test Server 1/2/3**: the serial server suite is split across three isolated runners. The shard
  that produces the thread-transfer budget publishes the single report artifact consumed by the
  reporting workflow.
- **Rust**: resource-monitor formatting and tests run in a dedicated job instead of installing the
  Rust toolchain in both the Check and Test jobs.
- **Windows 2025 x64 Parity**: a Windows 2025 runner uses Node 24 to start real `.cmd` provider
  fixtures, round-trip PowerShell arguments, open a ConPTY terminal, create a Git checkpoint ref in
  a `C:\...` workspace, and prove process-tree cleanup. It also runs the native Rust resource-monitor
  suite plus focused provider, terminal, checkpoint, path, desktop, and WSL-isolation tests before
  typechecking and building the desktop plus server pipeline. Finally, it installs the real per-user
  Scheduled Task against isolated state, force-crashes the tracked launcher, verifies Task Scheduler
  recovery, repairs deliberate task drift, and uninstalls without orphan processes.
- **Mobile Native Static Analysis**: `vp run lint:mobile` on macOS, wrapping
  `scripts/mobile-native-static-check.ts`. A cheap Linux **Mobile Native Changes** job gates it:
  the macOS runner only boots when the diff touches `apps/mobile` Swift/Kotlin sources, the
  SwiftLint/detekt/ktlint configuration, the `Brewfile`, the check script, the root `package.json`
  that defines `lint:mobile`, or `ci.yml`. Otherwise the job is skipped, which GitHub reports as
  success for the required check. Renames are matched on both their old and new path. The gate fails
  open in every other case: if the changed-file list cannot be resolved, GitHub truncates it, or the
  gate job itself fails, the lint runs.
- **Release Smoke**: exercises release-only workflow steps through `scripts/release-smoke.ts`, so
  release breakage surfaces on PRs rather than at tag time.

Fork CI uses GitHub-hosted `ubuntu-24.04`, `windows-2025`, and `macos-26` runners. Upstream's organization-scoped
Blacksmith labels are intentionally not used in this workflow.

`.github/workflows/release.yml` builds macOS (`arm64` and `x64`), Linux (`x64`), and Windows (`x64`)
desktop artifacts from a single `v*.*.*` tag and publishes one GitHub release. It auto-enables
signing for macOS when platform credentials are present. macOS passkey builds additionally require
`APPLE_TEAM_ID` and the `MACOS_PROVISIONING_PROFILE` secret. Windows uses Azure Trusted Signing and
official stable/nightly automation fails closed when any signing input is missing. Before npm or
GitHub publication, CI installs the signed NSIS package, verifies installed startup, and exercises a
real imported Ubuntu x64/glibc WSL instance with the shipped node-pty and telemetry sidecars. It then
exercises a signed N→N+1 mock-server update while preserving an SQLite sentinel.

See [Release Checklist](../operations/release.md) for the full release/signing setup checklist.
