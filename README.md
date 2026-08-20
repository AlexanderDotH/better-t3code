<div align="center">

# Better T3 Code

**T3 Code, plus the power-user buttons someone was inevitably going to add.**

An independent, batteries-included fork of [T3 Code](https://github.com/pingdotgg/t3code)
for people who looked at one coding agent and thought, “Great. Can it have coworkers?”

[What is better?](#yeah-but-what-does-this-thing-actually-do-better-than-t3-code) ·
[Run the fork](#run-the-fork) · [Documentation](#documentation) ·
[Sync audit](./docs/operations/upstream-sync.md) ·
[Upstream](https://github.com/pingdotgg/t3code)

</div>

Better T3 Code keeps the fast, open, remote-ready T3 Code core: bring your own Codex, Claude Code,
Cursor, Grok Build, OpenCode, or Gemini access and control it from the web, desktop, or mobile clients.
This fork adds the opinionated workflows around that core—the things that usually begin with,
“Okay, but could it also…?”

> [!IMPORTANT]
> `npx t3@latest`, [app.t3.codes](https://app.t3.codes), the official mobile apps, and the
> [upstream releases](https://github.com/pingdotgg/t3code/releases) are stock T3 Code. Run or build
> this repository to use the fork-only features below.

> [!WARNING]
> Install and authenticate at least one supported provider before use:
>
> - Codex: install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`
> - Claude: install [Claude Code](https://claude.com/product/claude-code) and run `claude auth login`
> - Cursor: install [Cursor CLI](https://cursor.com/cli) and run `agent login`
> - Grok Build: install [Grok Build CLI](https://x.ai/cli) and run `grok login`
> - OpenCode: install [OpenCode](https://opencode.ai) and run `opencode auth login`
> - Gemini: add `GOOGLE_API_KEY` or `GEMINI_API_KEY` to a Gemini provider instance

## “Yeah, but what does this thing actually do better than T3 Code?”

Excellent question, suspiciously direct stranger. The short version: Better T3 Code gives agents
coworkers, makes those coworkers visible, adds safer escape hatches, and includes substantially more
power-user plumbing around the chat.

| Workflow                   | T3 Code                                                     | Better T3 Code                                                                                                                                   |
| -------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Repository exploration** | A normal provider turn explores the project                 | **Fetch** can use an independently selected provider and model for a dynamically sized batch of transient, read-only exploration workers         |
| **Plan implementation**    | Implement a proposed plan normally                          | Review a plan with a fast model, choose a useful agent count, and implement it with provider-native subagents in parallel                        |
| **Project coordination**   | Agents work within their current thread                     | Authenticated project agents can claim work, exchange durable messages, inspect peers, and wake work in another thread                           |
| **Subagent visibility**    | Provider activity stays in the main conversation            | Live lifecycle pills, persistent agent history, and readable per-agent transcript dialogs                                                        |
| **Stopping runaway work**  | Standard cooperative stop                                   | Cooperative stop, second-click force stop, and automatic exact-runtime termination after roughly five seconds—without throwing away chat history |
| **Switching providers**    | A started thread remains bound to compatible provider state | Switch provider or model mid-thread with a complete transcript handoff when native resume is not compatible                                      |
| **Voice input**            | No built-in streaming dictation workflow                    | AssemblyAI dictation with a live waveform, project terminology indexing, and optional English output                                             |
| **Chat portability**       | Normal in-app thread history                                | Copy the complete unredacted transcript and import chats from sibling local T3 Code installations                                                |
| **Agent tooling**          | Provider-managed configuration                              | Visual MCP server management plus global/project skill discovery, import, enablement, and prompt integration                                     |
| **Prompt ergonomics**      | Standard prompt and reasoning controls                      | Optional prompt improvement and evidence-based, one-turn reasoning-effort recommendations                                                        |
| **Repository context**     | Providers use their regular filesystem tools                | A bounded `workspace_context` MCP tool batches common project discovery and file-reading work                                                    |
| **Version control**        | Core source-control actions                                 | A queued Git workbench adds typed operations, recovery refs, undo flows, and workspace-aware change views                                        |
| **Project organization**   | Standard project grouping                                   | Quiet projects move into **Older projects** at the exact seven-day inactivity boundary while attention states stay visible                       |
| **Product analytics**      | Anonymous PostHog product analytics                         | Outbound anonymous product analytics removed; local resource diagnostics stay local and useful                                                   |

> [!NOTE]
> **Fetch** and **Parallel plan implementation** are experimental, off by default, and currently
> available in the web, desktop, and mobile clients. Fetch is independent of the main chat provider: its
> server-side planner leaves simple and focused requests with the main agent, and launches the
> smallest useful number of workers only when parallel exploration materially helps. The built-in
> providers currently advertise eight-worker budgets, with no application-wide fixed ceiling; three
> is not a default. Each transient worker can consume additional provider quota. Experimental means
> “useful enough to keep” and “spicy enough to deserve a switch.”

Fetch model selection defaults to **Auto**: eligible Codex Spark, then Codex Luna with low
reasoning, then the environment's text-generation model or first Fetch-capable model. The environment
that owns the project resolves that selection and runs the transient read-only workers even when the
controlling client is remote. Successful findings survive partial worker failures; if every worker
fails, the unchanged main-provider turn still continues with a visible warning.

For the precise behavior of Fetch, parallel implementation, force stop, and temporary reasoning
overrides, see [Chat controls](./docs/user/chat-controls.md). The complete non-negotiable fork
contract and legacy-branch audit live in the [upstream synchronization record](./docs/operations/upstream-sync.md).

## The upstream good stuff is still here

- Use existing subscriptions for Codex, Claude Code, Cursor, Grok Build, and OpenCode, or a Gemini API key.
- Work from the web, the Electron desktop client, or the iOS and Android mobile clients.
- Connect locally, across a LAN or tailnet, or through T3 Connect.
- Keep durable threads, project state, provider sessions, and git checkpoints.
- Stay open source. If this fork becomes unbearably sensible, you can fork the fork. Nature heals.

## Run the fork

### Prerequisites

- Node.js `24.13.1` or a newer compatible Node 24 release
- [Vite+ (`vp`)](https://viteplus.dev/guide/)
- At least one installed and authenticated provider:
  [Codex](https://developers.openai.com/codex/cli),
  [Claude Code](https://claude.com/product/claude-code),
  [Cursor](https://cursor.com/cli),
  [Grok Build](https://x.ai/cli), or
  [OpenCode](https://opencode.ai), or a [Gemini API key](https://aistudio.google.com/app/apikey)

Install Vite+ on macOS or Linux:

```bash
curl -fsSL https://vite.plus | bash
```

On Windows PowerShell:

```powershell
irm https://vite.plus/ps1 | iex
```

### Start the web app and server

```bash
git clone https://github.com/AlexanderDotH/better-t3code.git
cd better-t3code
vp i
vp run dev
```

The dev runner prints the real local URL and a one-time pairing URL. Open the pairing URL—the bare
origin is just a very pretty locked door.

### Build a desktop artifact

```bash
# Linux AppImage
vp run dist:desktop:linux

# macOS DMG
vp run dist:desktop:dmg

# Windows installer
vp run dist:desktop:win
```

Want stock T3 Code instead? This is the intentionally boring command:

```bash
npx t3@latest
```

### Run the native server with Docker

```bash
T3CODE_ADVERTISED_URL=http://localhost:3773 docker compose up --build
```

The image runs the same headless server and includes every Better T3 Code provider CLI. Provider
credentials and projects stay outside the image in explicit volumes. See the
[container server guide](./docs/user/container-server.md).

## Documentation

- [Documentation map](./docs/README.md)
- [Install and first run](./docs/user/install.md)
- [Permission modes](./docs/user/permission-modes.md)
- [Chat controls and experimental workflows](./docs/user/chat-controls.md)
- [Source control and Git workbench](./docs/user/source-control.md)
- [MCP servers and provider-specific status](./docs/user/mcp-servers.md)
- [Remote access](./docs/user/remote-access.md)
- [Keeping clients and servers in sync](./docs/user/updating.md)
- [Keybindings](./docs/user/keybindings.md)
- [Multiple Codex accounts](./docs/user/providers-codex.md)
- [Multiple Claude accounts](./docs/user/providers-claude.md)
- [Gemini API provider](./docs/user/providers-gemini.md)
- [Internal architecture](./docs/internals/overview.md)
- [Internal glossary](./docs/internals/glossary.md)
- [Upstream synchronization and fork contract](./docs/operations/upstream-sync.md)

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or pull request. The project is MIT
licensed and remains deeply indebted to the excellent work in
[upstream T3 Code](https://github.com/pingdotgg/t3code).

Small fixes are welcome. Big ideas are welcome too, but may be asked to explain themselves to the
performance budget.
