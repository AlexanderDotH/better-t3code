# Install T3 Code

T3 Code is a web and desktop GUI for running coding agents on your machine.

## Requirements

Node.js `^22.16 || ^23.11 || >=24.10` on the machine that runs the T3 Code server.

At least one authenticated provider CLI or a Gemini API key. See [Providers](#providers) below.

## Run Without Installing

```bash
npx t3@latest
```

This starts the T3 Code server on your machine and opens the local web app. Use
`npx t3@latest --help` for the full CLI reference.

## Desktop App

Download the latest release from
[GitHub Releases](https://github.com/pingdotgg/t3code/releases), or install from a package
registry.

Windows:

```bash
winget install T3Tools.T3Code
```

The supported Windows desktop target is Windows 11 x64. The desktop app runs its local server and
coding agents directly on Windows; WSL is optional. There is no native Windows ARM64 installer in
this release line.

Provider CLIs must be available to PowerShell and to desktop apps started after login. Check them
from a new PowerShell window with `Get-Command codex`, `Get-Command claude`,
`Get-Command cursor-agent`, `Get-Command grok`, or `Get-Command opencode`. If an installer changed
`PATH`, close and reopen T3 Code before testing the provider again. Gemini uses its API key and does
not require a CLI.

Use normal `C:\...` project folders for the native Windows backend. If you enable the optional WSL
backend, use a current x64/glibc WSL 2 distribution with Node.js installed. Projects inside that
distribution appear through `\\wsl.localhost\<distro>\...`; a missing or unhealthy WSL setup does
not prevent the native Windows backend from starting.

Official Windows installers and installed executables are Authenticode-signed. Windows may still
show a first-download reputation prompt, but Properties → Digital Signatures must show the
publisher named on the release. Do not continue if the signature is missing or invalid.

### Windows updates and troubleshooting

Desktop updates stay on the selected Latest or Nightly channel. An update downloads in the
background, then fully restarts the desktop app when you choose to install it; let active agent and
terminal work finish first. Projects, conversations, and settings remain in the same T3 data
directory across the update.

If Windows startup or an update fails:

- Check `%USERPROFILE%\.t3\userdata\logs\desktop.trace.ndjson` and `server-child.log` for the
  native desktop and local-server startup records.
- Confirm the installed executable still has a valid Digital Signatures entry. Reinstall from the
  official release if it does not.
- Test provider discovery again from a new PowerShell window, then reopen T3 Code so it inherits the
  updated environment.
- Disable the optional WSL backend while diagnosing its distribution, Linux Node.js, or UNC-path
  access. A WSL failure should not block native Windows projects.
- Keep loopback access allowed for T3 Code. Remote and T3 Connect access may additionally need the
  Windows Firewall prompt accepted for the selected network profile.

macOS:

```bash
brew install --cask t3-code
```

Arch Linux:

Stable:

```bash
yay -S t3code-bin
```

Nightly:

```bash
yay -S t3code-nightly-bin
```

### Windows Subsystem for Linux

When the desktop app runs a WSL backend, it installs the matching server runtime into
`~/.t3/wsl-runtime` inside the selected distro. The first launch after installing or updating T3
Code may take a little longer while that release's runtime is extracted. Later launches reuse the
Linux-local copy so startup does not depend on reading application files through `/mnt/c`. After a
successful launch, T3 Code keeps the current runtime and one previous runtime for rollback and
removes older caches automatically. If a cached runtime stops working, T3 Code launches from the
application files under `/mnt/c` instead and reinstalls the runtime on the next launch.

## Providers

T3 Code drives provider CLIs for Codex, Claude, Cursor, Grok, and OpenCode. Gemini uses the official
Google SDK directly and needs an API key instead of a separate CLI.

| Provider   | CLI                                                   | Default binary | Log in with           |
| ---------- | ----------------------------------------------------- | -------------- | --------------------- |
| Codex      | [Codex CLI](https://developers.openai.com/codex/cli)  | `codex`        | `codex login`         |
| Claude     | [Claude Code](https://claude.com/product/claude-code) | `claude`       | `claude auth login`   |
| Cursor     | [Cursor CLI](https://cursor.com/cli)                  | `cursor-agent` | `agent login`         |
| Grok Build | [Grok Build CLI](https://x.ai/cli)                    | `grok`         | `grok login`          |
| OpenCode   | [OpenCode](https://opencode.ai)                       | `opencode`     | `opencode auth login` |
| Gemini     | [Gemini API](https://ai.google.dev/gemini-api/docs)   | None           | Add an API key in T3  |

Codex, Claude, Grok Build, and OpenCode are on by default. Cursor and Gemini are off by default;
turn them on in **Settings** → the provider's card when you want to use them. An explicit saved
disable always wins over these defaults.

Cursor is the one to watch: install Cursor CLI, which provides the `cursor-agent` binary that
T3 Code looks for, but authenticate with `agent login`, not `cursor-agent login`.

Grok models that support adjustable reasoning show a **Reasoning** control beside the model picker.
The available levels and default come from the installed Grok Build CLI, so they can vary by model
and CLI version.

Run the login command on the machine running the T3 Code server, not on the device you browse
from.

For Gemini, add `GOOGLE_API_KEY` (preferred) or `GEMINI_API_KEY` to the Gemini provider instance's
**Environment variables** in Settings. The key stays on the T3 server; web, desktop, and mobile
clients only see the provider status and model catalog. See [Gemini](./providers-gemini.md).

### Binary Discovery

Each CLI-backed provider must be on the server's `PATH`, or have an explicit binary path set in
**Settings** → the provider instance → **Binary path**. Use the explicit path when a version
manager or a non-standard install location keeps the CLI off the `PATH` of the shell that
started T3 Code.

### When Auth Is Needed

Provider auth is required before you start a session with that provider, not before you start
T3 Code. You can install T3 Code, open it, and add providers afterwards. A provider that is not
authenticated shows its status in **Settings** and fails at session start with the login command
to run or the missing API-key variable to add.

For multi-account setups, see [Codex](./providers-codex.md) and [Claude](./providers-claude.md).

## Next Steps

- [Permission modes](./permission-modes.md): how much T3 Code asks before acting
- [Remote access](./remote-access.md): connect from a phone, tablet, or another desktop
- [Keeping T3 Code in sync](./updating.md): client and server version skew
- [Running in the background](./background-service.md): Linux, macOS, and Windows background service
