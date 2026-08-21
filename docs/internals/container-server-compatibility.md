# Container server compatibility

The container target composes the existing `t3 serve` runtime. It is not a separate orchestration
implementation and must not acquire its own database, provider registry, or connection model.

| Feature                                                                     | Remote server ownership                         | Container status                                                                              |
| --------------------------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Threads, turns, checkpoints, pin/snooze/settle, model and context selection | Server event store and projectors               | Supported with persistent `/data`                                                             |
| Codex, Claude, Cursor, Grok, OpenCode, Gemini                               | Provider instance registry and adapters         | Supported when credentials are supplied                                                       |
| Fetch, plan parallelism, project agents, subagent history, force stop       | Server orchestration and provider runtimes      | Supported; cgroup budget is authoritative                                                     |
| Terminals, files, `workspace_context`, MCP, skills                          | Server child processes and workspace services   | Supported inside mounted workspace/home                                                       |
| Git workbench and pull requests                                             | Server VCS/source-control services              | Supported with Git/SSH/provider CLIs                                                          |
| Voice and project terminology                                               | Server speech services plus client audio stream | Supported with outbound HTTPS and keys                                                        |
| Direct, bearer, Tailscale, SSH-forwarded, T3 Connect                        | Shared connection/auth runtime                  | Supported; advertised URL describes the external route                                        |
| Chat import                                                                 | Server read-only SQLite import                  | Supported for explicitly mounted source homes                                                 |
| Resource diagnostics and admission                                          | Native sidecar plus server governor             | Supported on glibc amd64/arm64; cgroup-aware                                                  |
| Desktop SSH launcher, native picker/editor launch                           | Electron/host integration                       | Intentionally client-only                                                                     |
| Integrated dev-server preview                                               | Server discovery plus desktop browser host      | Direct private-network ports work when published; public relay forwarding remains unsupported |

## Runtime boundaries

- Container configuration is process configuration in `ServerConfig`; domain and orchestration
  services do not branch on Docker.
- The server binds its private listener independently from the public advertised URL. Pairing uses
  the advertised URL, while the listener remains suitable for Docker Bridge and reverse proxies.
- Container replacement is an external update method. The self-update RPC never modifies an image.
- Capability fields remain optional so older clients ignore container- and preview-specific
  additions safely.

## Security invariants

- Pairing and session authentication stay mandatory on non-loopback deployments.
- No provider credential, source-control token, pairing token, or user home is copied into an image.
- A future preview gateway must reach only server-confirmed loopback listeners and remain scoped to
  the authenticated client, environment, port, and tab lifetime. A long-lived bearer token in a
  preview URL is not an acceptable shortcut.
- The reference deployment requires neither privileged mode, host PID access, nor the Docker
  control socket.
- The container boundary limits filesystem visibility but does not replace T3's provider approval
  and sandbox policies.

## Verification boundary

Unit and integration tests prove configuration, contracts, cgroup parsing, auth, and persistence.
The image build additionally proves its native monitor, application bundle, and provider-tool
installation. A runtime smoke test must separately prove non-root startup, pairing, WebSocket sync,
restart persistence, graceful SIGTERM, provider binary discovery, and SQLite integrity. Public
relay preview forwarding is outside the current implementation and therefore outside this proof.
