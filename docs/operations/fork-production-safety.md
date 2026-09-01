# Fork production automation safety

> For maintainers of Better T3 Code forks. The upstream release runbook remains in
> [release.md](./release.md).

T3 Code includes workflows that can publish packages and releases, deploy hosted infrastructure,
and submit mobile builds. GitHub copies those workflow files into forks, where scheduled and
`main`-push triggers otherwise remain live.

## Default policy

Production automation is disabled unless either condition is true:

- the repository is `pingdotgg/t3code`; or
- the repository variable `T3_ENABLE_PRODUCTION_AUTOMATION` is exactly `true`.

The guard is repeated on every production-capable job in:

- `.github/workflows/release.yml`;
- `.github/workflows/mobile-eas-production.yml`; and
- `.github/workflows/deploy-relay.yml`.

Fork maintainers should also leave those workflows disabled in GitHub. The source guard protects a
fork if an upstream synchronization re-enables a workflow; the remote disabled state prevents runs
from being queued at all.

## Verify a fork

Replace the repository argument below only with the fork being audited. Never target the upstream
repository when changing workflow state.

```sh
gh api repos/AlexanderDotH/better-t3code/actions/workflows \
  --jq '.workflows[] | select(.path == ".github/workflows/release.yml" or .path == ".github/workflows/mobile-eas-production.yml" or .path == ".github/workflows/deploy-relay.yml") | [.path, .state] | @tsv'

gh run list --repo AlexanderDotH/better-t3code \
  --workflow release.yml --status queued --limit 100

gh release list --repo AlexanderDotH/better-t3code
```

Expected workflow state for the Better T3 Code fork is `disabled_manually`, with no queued Release
runs. Repository and production-environment secrets must not be treated as a substitute for the
guard: missing credentials can become available later.

Run the source-policy regression with Node 24:

```sh
vp test run scripts/production-workflow-policy.test.ts
```

## CI and packaging boundaries

The normal pull-request workflow and the production workflows prove different things. A skipped or
credential-blocked production job is not packaging evidence.

- **Check** compiles the desktop pipeline on Ubuntu and verifies the preload bundle. It does not
  produce an AppImage, DMG, or NSIS installer.
- **Mobile Android Debug Build** conditionally creates an arm64 debug APK when native Android inputs
  change. Ordinary TypeScript changes stay on the unit and typecheck path, and the job does not
  launch an emulator.
- **Windows 2025 x64 Parity** exercises native command shims, PowerShell, ConPTY, Git and process
  cleanup, focused WSL contracts, typechecks, and the desktop/server build pipeline. The installed
  NSIS update and isolated Ubuntu WSL runtime smoke belong to the release workflow.
- **Release Smoke** exercises release scripts and update-manifest handling. It does not package or
  launch an application.

Actual desktop packaging is owned by [the release workflow](../../.github/workflows/release.yml):
macOS arm64/x64 DMGs, a Linux x64 AppImage, and a Windows x64 NSIS installer. macOS signing and
notarization, Windows signing, installed-update smoke, and the real WSL runtime require their
platform runners and configured credentials. The label-gated
[macOS preview](../../.github/workflows/desktop-macos-preview.yml) builds an unsigned arm64 DMG and
does not replace the release matrix.

Mobile simulator and store evidence is also separate. The manually dispatched
[showcase workflow](../../.github/workflows/mobile-showcase-screenshots.yml) drives iOS Simulator and
Android Emulator captures. [EAS preview](../../.github/workflows/mobile-eas-preview.yml) requires
the preview label and `EXPO_TOKEN`; [EAS production](../../.github/workflows/mobile-eas-production.yml)
requires the repository guard plus `EXPO_TOKEN`. None of those external runs may be inferred from
unit tests, a generated native project, or a build artifact alone. See
[CI quality gates](../internals/ci.md) and [Release](./release.md) for the owning runbooks.

## Disable and drain a fork

Disable the workflows before cancelling queued runs so a new scheduled run cannot enter the queue
during cleanup:

```sh
gh workflow disable .github/workflows/release.yml \
  --repo AlexanderDotH/better-t3code
gh workflow disable .github/workflows/mobile-eas-production.yml \
  --repo AlexanderDotH/better-t3code
gh workflow disable .github/workflows/deploy-relay.yml \
  --repo AlexanderDotH/better-t3code
```

Inspect each queued run before cancelling it. Record whether any steps ran, then cancel only the
verified fork run by its numeric ID:

```sh
gh run view RUN_ID --repo AlexanderDotH/better-t3code --json status,conclusion,jobs,url
gh run cancel RUN_ID --repo AlexanderDotH/better-t3code
```

Afterward, repeat the verification commands and check releases, tags, deployments, and packages for
unexpected external effects.

## Explicit opt-in

Enabling production automation is a separate operational decision, not part of an upstream sync.
It requires named maintainer approval and a review of every destination account, credential,
environment, package name, domain, and mobile application identifier.

Only after that review:

1. Set `T3_ENABLE_PRODUCTION_AUTOMATION=true` on the fork.
2. Enable only the workflow needed for the approved operation.
3. Run it against an explicit fork ref and monitor every job.
4. Remove the variable and disable the workflow again when the operation is complete.

The variable must never be set merely to make a skipped check green.
