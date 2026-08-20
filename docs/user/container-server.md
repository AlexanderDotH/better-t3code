# Running the Better T3 Code server in a container

The container runs the same `t3 serve` backend used by a native headless install. Projects,
threads, provider processes, terminals, Git, MCP, Fetch, checkpoints, and settings remain owned by
that server; Docker only supplies its filesystem and process boundary.

## Start with Compose

Set the workspace to mount and the URL clients can actually reach:

```sh
export T3_WORKSPACE=/srv/projects
export T3CODE_ADVERTISED_URL=https://code.example.com
docker compose build t3-server
docker compose up -d t3-server
docker compose logs t3-server
```

The startup log contains a one-time pairing URL. Open it from a Better T3 Code web or desktop
client, or scan it with the mobile client. `T3CODE_ADVERTISED_URL` must be the external HTTP(S)
origin, not the container name or its `172.x` bridge address.

For a direct trusted-LAN setup, publish port 3773 and use an `http://host:3773` advertised URL. For
the hosted HTTPS app or an internet-facing deployment, terminate TLS in a reverse proxy and use the
matching `https://` URL. The proxy must forward WebSocket upgrades.

## Persistent data

The reference Compose file keeps three boundaries explicit:

- `/data` contains SQLite state, the environment identity, attachments, logs, secrets, and managed
  worktrees. Back this volume up as one unit.
- `/workspace` is the repository root visible to agents, terminals, Git, and MCP tools.
- `/home/t3` contains provider logins, SSH/Git configuration, imported skills, and user MCP files.

Keep the SQLite database on a local Docker volume. Do not place it on NFS or another network
filesystem with weaker locking semantics. To import chats from another installation, mount its
`.t3-*` directory read-only below `/home/t3` while importing.

## Providers and source control

The all-provider image installs Codex, Claude Code, Cursor Agent, Grok Build, and OpenCode. Gemini
uses the server's bundled Google SDK. Provider credentials are never part of the image; supply API
keys through your secret manager or persist an authenticated provider home under `/home/t3`.

Git, Git LFS, OpenSSH, GitHub CLI, GitLab CLI, and Azure CLI with the Azure DevOps extension are
included. Mount SSH configuration read-only or use the provider token variables shown in
`compose.yaml`. Bitbucket uses its API token directly and does not require another CLI.
Use either `T3CODE_BITBUCKET_ACCESS_TOKEN`, or the
`T3CODE_BITBUCKET_EMAIL`/`T3CODE_BITBUCKET_API_TOKEN` pair.

The reference image also includes Node 24, Python 3, a C/C++ build toolchain, ripgrep, archive
utilities, and common process diagnostics. Extend `deploy/container/Dockerfile` from this image for
project-specific SDKs such as Java, Go, Rust, Android, or database clients; those toolchains are
part of the environment you are creating, not T3 server state.

## Updates and health

Container servers advertise that their lifecycle is container-managed. Update by pulling or
building a new image digest and recreating the service; do not run `t3 service update` inside the
container.

Docker can probe:

- `GET /healthz` for liveness;
- `GET /readyz` after the complete server runtime is ready.

Both responses are deliberately minimal and do not expose projects, credentials, or machine state.

The container runs as an unprivileged user, drops Linux capabilities, uses a read-only root
filesystem, and does not mount the Docker socket. Add only the workspace and credential access the
agents actually need.

## Resource limits

Set a Docker memory limit appropriate for the number of simultaneous agents. Better T3 Code reads
cgroup v1 or v2 memory limits and feeds the effective budget into the same resource governor used
by native servers. The process monitor still reports the server-owned provider tree; no host PID
namespace is required.

## Platform-specific features

Desktop-managed SSH launch, native folder pickers, opening a host editor, and desktop application
updates remain client/host functions. They are not reimplemented inside the container. All
server-owned workflows remain available when their provider credentials and workspace paths are
present.

### Dev-server previews

The server can discover dev servers running in the container. A desktop client can open one
directly when that port is reachable from the client: bind the dev server to `0.0.0.0` and publish
the same port from the container. For example, add this alongside the existing `3773` mapping:

```yaml
ports:
  - "3773:3773"
  - "5173:5173"
```

Do not expose a broad port range by default. Public T3 Connect/relay endpoints currently carry the
T3 server connection, not arbitrary loopback ports. Integrated previews through those endpoints
need the authenticated preview gateway described in the compatibility matrix; until that lands,
use a private-network-reachable published port or an explicit operator-managed tunnel.

See [Remote Access](./remote-access.md) for pairing and transport choices and the
[container compatibility matrix](../internals/container-server-compatibility.md) for maintainers.
